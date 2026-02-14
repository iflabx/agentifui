// lib/stores/current-app-store.ts
import { clearDifyConfigCache } from '@lib/config/dify-config';
import { getDefaultProvider, getDefaultServiceInstance } from '@lib/db';
import type { Provider, ServiceInstance } from '@lib/types/database';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Added: import cache clearing function

interface CurrentAppState {
  currentAppId: string | null;
  currentAppInstance: ServiceInstance | null;
  isLoadingAppId: boolean;
  errorLoadingAppId: string | null;
  lastValidatedAt: number | null; // Added: last validation timestamp
  isValidating: boolean; // Added: whether config is being validated
  isValidatingForMessage: boolean; // Added: validation state specifically for message sending
  setCurrentAppId: (appId: string, instance: ServiceInstance) => void;
  clearCurrentApp: () => void;
  initializeDefaultAppId: () => Promise<void>;
  refreshCurrentApp: () => Promise<void>;
  validateAndRefreshConfig: (
    targetAppId?: string,
    context?: 'message' | 'switch' | 'general'
  ) => Promise<void>; // Modified: add context parameter
  switchToApp: (appId: string) => Promise<void>; // Added: switch to a specific app
}

type ServiceInstanceWithProvider = ServiceInstance & {
  providers?: {
    id: string;
    name: string;
    is_active: boolean;
    is_default: boolean;
  } | null;
};

// Refactor: Remove hardcoding, rely only on is_default field in database
// Helper function to get the default provider, supports multi-provider environments
async function getDefaultProviderForApp(): Promise<Provider> {
  // Get the system default provider (based on is_default field)
  const defaultProviderResult = await getDefaultProvider();

  if (defaultProviderResult.success && defaultProviderResult.data) {
    return defaultProviderResult.data;
  }

  // If no default provider is set, throw an error to require admin configuration
  throw new Error(
    'No default provider found. Please set a provider as default in the admin panel.'
  );
}

export const useCurrentAppStore = create<CurrentAppState>()(
  persist(
    (set, get) => ({
      currentAppId: null,
      currentAppInstance: null,
      isLoadingAppId: false,
      errorLoadingAppId: null,
      lastValidatedAt: null, // Added: last validation timestamp
      isValidating: false, // Added: whether config is being validated
      isValidatingForMessage: false, // Added: validation state specifically for message sending

      setCurrentAppId: (appId, instance) => {
        set({
          currentAppId: appId,
          currentAppInstance: instance,
          isLoadingAppId: false,
          errorLoadingAppId: null,
          lastValidatedAt: Date.now(), // Update validation timestamp
        });
        // @future When appId changes, may need to trigger reload of related data
        // For example, useConversations may need to refresh based on new appId.
        // This can be done by subscribing to currentAppId in useConversations,
        // or by calling a global refresh function/event here.
      },

      clearCurrentApp: () => {
        set({
          currentAppId: null,
          currentAppInstance: null,
          isLoadingAppId: false,
          errorLoadingAppId: null,
          lastValidatedAt: null, // Clear validation timestamp
          isValidating: false, // Clear validation state
          isValidatingForMessage: false, // Clear message validation state
        });
      },

      initializeDefaultAppId: async () => {
        // Prevent re-initialization or loading if already loaded
        if (get().currentAppId || get().isLoadingAppId) {
          return;
        }

        // Security check: ensure user is logged in before initializing app store
        // Prevent unauthenticated users from triggering cache creation
        try {
          const { getCurrentUser } = await import(
            '@lib/auth/better-auth/http-client'
          );
          const user = await getCurrentUser();

          if (!user) {
            console.log(
              '[CurrentAppStore] User not logged in, skipping app store initialization'
            );
            return;
          }
        } catch (authError) {
          console.warn(
            '[CurrentAppStore] Auth check failed, skipping initialization:',
            authError
          );
          return;
        }

        set({ isLoadingAppId: true, errorLoadingAppId: null });

        try {
          // Refactor: use default provider instead of hardcoded Dify provider
          // Support multi-provider environment, prefer system default provider
          const provider = await getDefaultProviderForApp();

          const defaultInstanceResult = await getDefaultServiceInstance(
            provider.id
          );

          if (!defaultInstanceResult.success) {
            throw new Error(
              `Failed to get default service instance: ${defaultInstanceResult.error.message}`
            );
          }

          if (
            defaultInstanceResult.data &&
            defaultInstanceResult.data.instance_id
          ) {
            set({
              currentAppId: defaultInstanceResult.data.instance_id,
              currentAppInstance: defaultInstanceResult.data,
              isLoadingAppId: false,
              lastValidatedAt: Date.now(), // Set validation timestamp
            });
          } else {
            // If there is no default service instance in the database, this needs to be handled.
            // The UI should prompt the user to select an app, or the admin should configure a default app.
            // For now, set appId to null and record the error.
            const errorMessage = `No default service instance found for provider "${provider.name}". Please configure a default app instance.`;
            console.warn(errorMessage);
            set({
              currentAppId: null,
              currentAppInstance: null,
              isLoadingAppId: false,
              errorLoadingAppId: errorMessage,
            });
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error('Failed to initialize default app ID:', errorMessage);
          set({
            isLoadingAppId: false,
            errorLoadingAppId: errorMessage,
          });
        }
      },

      // Added: refresh current app method, used to fetch the latest app instance info
      refreshCurrentApp: async () => {
        const currentState = get();

        if (!currentState.currentAppInstance) {
          // If there is no current app, try to initialize the default app
          await get().initializeDefaultAppId();
          return;
        }

        set({ isLoadingAppId: true, errorLoadingAppId: null });

        try {
          const defaultInstanceResult = await getDefaultServiceInstance(
            currentState.currentAppInstance.provider_id
          );

          if (!defaultInstanceResult.success) {
            throw new Error(
              `Failed to refresh app instance: ${defaultInstanceResult.error.message}`
            );
          }

          if (
            defaultInstanceResult.data &&
            defaultInstanceResult.data.instance_id
          ) {
            set({
              currentAppId: defaultInstanceResult.data.instance_id,
              currentAppInstance: defaultInstanceResult.data,
              isLoadingAppId: false,
              lastValidatedAt: Date.now(), // Set validation timestamp
            });
          } else {
            const errorMessage = 'Default service instance not found';
            set({
              isLoadingAppId: false,
              errorLoadingAppId: errorMessage,
            });
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error('Failed to refresh current app:', errorMessage);
          set({
            isLoadingAppId: false,
            errorLoadingAppId: errorMessage,
          });
        }
      },

      // Added: validate and refresh config method
      // Checks if the current config is still valid, if not, re-fetches it
      // Supports validating a specific app or the default app
      // Used to solve sync issues after admin config changes
      validateAndRefreshConfig: async (
        targetAppId?: string,
        context: 'message' | 'switch' | 'general' = 'general'
      ) => {
        const currentState = get();

        // Set different validation states based on context
        if (context === 'message') {
          set({ isValidating: true, isValidatingForMessage: true });
        } else {
          set({ isValidating: true, isValidatingForMessage: false });
        }

        try {
          // If a targetAppId is specified, switch to that app
          if (targetAppId && targetAppId !== currentState.currentAppId) {
            console.log(
              `[validateAndRefreshConfig] Switching to specified app: ${targetAppId}`
            );
            await get().switchToApp(targetAppId);
            return;
          }

          // If there is no current config, initialize directly
          if (!currentState.currentAppId || !currentState.currentAppInstance) {
            await get().initializeDefaultAppId();
            return;
          }

          // Check if validation is needed (avoid frequent validation)
          const now = Date.now();
          const lastValidated = currentState.lastValidatedAt || 0;
          const VALIDATION_INTERVAL = 30 * 1000; // 30 seconds validation interval

          if (now - lastValidated < VALIDATION_INTERVAL && !targetAppId) {
            console.log(
              '[validateAndRefreshConfig] Validation interval not reached, skipping validation'
            );
            return;
          }

          console.log(
            '[validateAndRefreshConfig] Start validating config validity...'
          );

          // Support validating a specific app instance, not just the default app
          let targetInstance: ServiceInstanceWithProvider | null = null;

          if (targetAppId) {
            // Refactor: search for the specified app instance among all active providers
            // Support app validation in multi-provider environments
            const { createClient } = await import('../supabase/client');
            const supabase = createClient();

            const { data: specificInstance, error: specificError } =
              await supabase
                .from('service_instances')
                .select(
                  `
                *,
                providers!inner(
                  id,
                  name,
                  is_active,
                  is_default
                )
              `
                )
                .eq('instance_id', targetAppId)
                .eq('providers.is_active', true)
                .single();

            if (specificError || !specificInstance) {
              throw new Error(
                `Specified app instance not found: ${targetAppId}`
              );
            }

            targetInstance = specificInstance;
          } else {
            // Refactor: when validating the current app, also support multi-provider lookup
            // If the current app does not exist, fallback to the default provider's default app
            const { createClient } = await import('../supabase/client');
            const supabase = createClient();

            const { data: currentInstance, error: currentError } =
              await supabase
                .from('service_instances')
                .select(
                  `
                *,
                providers!inner(
                  id,
                  name,
                  is_active,
                  is_default
                )
              `
                )
                .eq('instance_id', currentState.currentAppId)
                .eq('providers.is_active', true)
                .single();

            if (currentError || !currentInstance) {
              // Current app does not exist, fallback to default provider's default app
              console.warn(
                `[validateAndRefreshConfig] Current app ${currentState.currentAppId} not found, fallback to default app`
              );

              const provider = await getDefaultProviderForApp();
              const defaultInstanceResult = await getDefaultServiceInstance(
                provider.id
              );

              if (
                !defaultInstanceResult.success ||
                !defaultInstanceResult.data
              ) {
                console.warn(
                  '[validateAndRefreshConfig] Default service instance also not found, clearing current config'
                );
                get().clearCurrentApp();
                return;
              }

              targetInstance = defaultInstanceResult.data;
            } else {
              targetInstance = currentInstance;
            }
          }

          if (!targetInstance) {
            throw new Error('Target app instance is missing after validation');
          }

          // Check if the current config matches the target config
          // Fix: check not only ID, but also if instance details have changed
          const hasInstanceChanged =
            currentState.currentAppId !== targetInstance.instance_id ||
            currentState.currentAppInstance?.display_name !==
              targetInstance.display_name ||
            currentState.currentAppInstance?.description !==
              targetInstance.description ||
            currentState.currentAppInstance?.config !== targetInstance.config;

          if (hasInstanceChanged) {
            console.log(
              '[validateAndRefreshConfig] Config has changed, updating to latest config'
            );

            // On config change, clear Dify config cache to ensure API calls use latest config
            if (currentState.currentAppId) {
              clearDifyConfigCache(currentState.currentAppId);
            }
            if (targetInstance.instance_id !== currentState.currentAppId) {
              clearDifyConfigCache(targetInstance.instance_id);
            }

            set({
              currentAppId: targetInstance.instance_id,
              currentAppInstance: targetInstance,
              lastValidatedAt: now,
              errorLoadingAppId: null,
            });
          } else {
            console.log(
              '[validateAndRefreshConfig] Config is still valid, updating validation timestamp'
            );
            set({ lastValidatedAt: now });
          }
        } catch (error) {
          console.error(
            '[validateAndRefreshConfig] Error during config validation:',
            error
          );
          // Error recovery: on validation failure, do not clear config, just record the error
          // This ensures that even if the database is temporarily unavailable, the user can still use the cached config
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          set({
            errorLoadingAppId: `Config validation failed: ${errorMessage}. Using cached config, please check network connection.`,
            lastValidatedAt: Date.now(), // Even on failure, update timestamp to avoid frequent retries
          });
        } finally {
          // Clear all validation states
          set({ isValidating: false, isValidatingForMessage: false });
        }
      },

      // Added: method to switch to a specific app
      // Refactor: support multi-provider, search for app instance among all active providers
      switchToApp: async (appId: string) => {
        console.log(`[switchToApp] Start switching to app: ${appId}`);

        set({ isLoadingAppId: true, errorLoadingAppId: null });

        try {
          // Refactor: search for app instance among all active providers, not just default provider
          // This allows switching to apps from different providers
          const { createClient } = await import('../supabase/client');
          const supabase = createClient();

          // First, search for the specified app instance among all active providers
          const { data: targetInstance, error: targetError } = await supabase
            .from('service_instances')
            .select(
              `
              *,
              providers!inner(
                id,
                name,
                is_active,
                is_default
              )
            `
            )
            .eq('instance_id', appId)
            .eq('providers.is_active', true)
            .single();

          if (targetError || !targetInstance) {
            throw new Error(`App instance not found: ${appId}`);
          }

          // Clear old config cache
          const currentState = get();
          if (currentState.currentAppId) {
            clearDifyConfigCache(currentState.currentAppId);
          }
          clearDifyConfigCache(appId);

          // Update state
          set({
            currentAppId: targetInstance.instance_id,
            currentAppInstance: targetInstance,
            isLoadingAppId: false,
            errorLoadingAppId: null,
            lastValidatedAt: Date.now(),
          });

          console.log(
            `[switchToApp] Successfully switched to app: ${appId}, provider: ${targetInstance.providers?.name}`
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(`[switchToApp] Failed to switch app:`, error);
          set({
            isLoadingAppId: false,
            errorLoadingAppId: `Failed to switch app: ${errorMessage}`,
          });
          throw error; // Rethrow error for caller to handle
        }
      },
    }),
    {
      name: 'current-app-storage', // Key in localStorage
      storage: createJSONStorage(() => localStorage),
      // Only persist appId and instance, other states are temporary
      partialize: state => ({
        currentAppId: state.currentAppId,
        currentAppInstance: state.currentAppInstance,
      }),
    }
  )
);

// Usage suggestion:
// In the top-level of your main layout component (e.g. app/providers.tsx or app/layout.tsx),
// use useEffect to call initializeDefaultAppId once, to ensure the app tries to set a default app on load.
// For example:
// import { useEffect } from 'react';
// import { useCurrentAppStore } from '@lib/stores/current-app-store';
//
// function AppProviders({ children }) { // or your root layout component
//   const initializeDefaultAppId = useCurrentAppStore(state => state.initializeDefaultAppId);
//
//   useEffect(() => {
//     initializeDefaultAppId();
//   }, [initializeDefaultAppId]);
//
//   return <>{children}</>;
// }
