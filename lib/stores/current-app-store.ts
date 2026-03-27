// lib/stores/current-app-store.ts
import type { ServiceInstance } from '@lib/types/database';
import { logCurrentAppDebugSnapshot } from '@lib/utils/current-app-debug';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

function clearDifyConfigCacheClient(_appId?: string) {
  // Server-side Dify config cache is process-local and should be invalidated by
  // write-path hooks; client-side store only needs to refresh its own state.
}

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
  provider?: {
    id: string;
    name: string;
    is_active: boolean;
    is_default: boolean;
  } | null;
};

const NO_DEFAULT_APP_MESSAGE =
  'No default service instance found. Please configure a default app instance.';
const DEFAULT_APP_RETRY_COOLDOWN_MS = 30_000;

let defaultAppRetryAfter = 0;

type AppLookupResult = {
  app: ServiceInstanceWithProvider | null;
  defaultMissing: boolean;
};

async function fetchAppFromInternalApi(
  query: URLSearchParams
): Promise<AppLookupResult> {
  const response = await fetch(`/api/internal/apps?${query.toString()}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    return {
      app: null,
      defaultMissing:
        query.get('mode') === 'default' && response.status === 404,
    };
  }

  const payload = (await response.json()) as {
    success: boolean;
    app?: ServiceInstanceWithProvider;
    defaultMissing?: boolean;
  };

  return {
    app: payload.success && payload.app ? payload.app : null,
    defaultMissing: Boolean(payload.defaultMissing),
  };
}

async function fetchDefaultAppInstance() {
  if (defaultAppRetryAfter > Date.now()) {
    return null;
  }

  const result = await fetchAppFromInternalApi(
    new URLSearchParams({ mode: 'default' })
  );
  if (result.app) {
    defaultAppRetryAfter = 0;
    return result.app;
  }

  if (result.defaultMissing) {
    defaultAppRetryAfter = Date.now() + DEFAULT_APP_RETRY_COOLDOWN_MS;
  }

  return null;
}

async function fetchActiveAppInstance(instanceId: string) {
  const result = await fetchAppFromInternalApi(
    new URLSearchParams({ instanceId: instanceId.trim() })
  );
  return result.app;
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
        logCurrentAppDebugSnapshot(
          '[CurrentAppDebug] CurrentAppStore setCurrentAppId',
          {
            source: 'lib/stores/current-app-store.ts',
            currentAppId: appId,
            currentAppInstanceId: instance.instance_id,
            currentAppDisplayName: instance.display_name ?? null,
            note: 'setCurrentAppId called',
          }
        );
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
          const existingState = get();
          logCurrentAppDebugSnapshot(
            '[CurrentAppDebug] CurrentAppStore initialize skipped',
            {
              source: 'lib/stores/current-app-store.ts',
              currentAppId: existingState.currentAppId,
              currentAppInstanceId:
                existingState.currentAppInstance?.instance_id ?? null,
              currentAppDisplayName:
                existingState.currentAppInstance?.display_name ?? null,
              note: 'initializeDefaultAppId skipped because currentAppId or loading already exists',
              extra: {
                isLoadingAppId: existingState.isLoadingAppId,
              },
            }
          );
          return;
        }

        if (defaultAppRetryAfter > Date.now()) {
          set({
            currentAppId: null,
            currentAppInstance: null,
            isLoadingAppId: false,
            errorLoadingAppId: NO_DEFAULT_APP_MESSAGE,
          });
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
          const defaultInstance = await fetchDefaultAppInstance();

          if (defaultInstance && defaultInstance.instance_id) {
            set({
              currentAppId: defaultInstance.instance_id,
              currentAppInstance: defaultInstance,
              isLoadingAppId: false,
              lastValidatedAt: Date.now(), // Set validation timestamp
              errorLoadingAppId: null,
            });
            logCurrentAppDebugSnapshot(
              '[CurrentAppDebug] CurrentAppStore default app initialized',
              {
                source: 'lib/stores/current-app-store.ts',
                currentAppId: defaultInstance.instance_id,
                currentAppInstanceId: defaultInstance.instance_id,
                currentAppDisplayName: defaultInstance.display_name ?? null,
                note: 'initializeDefaultAppId resolved default instance',
              }
            );
          } else {
            set({
              currentAppId: null,
              currentAppInstance: null,
              isLoadingAppId: false,
              errorLoadingAppId: NO_DEFAULT_APP_MESSAGE,
            });
            logCurrentAppDebugSnapshot(
              '[CurrentAppDebug] CurrentAppStore default app missing',
              {
                source: 'lib/stores/current-app-store.ts',
                currentAppId: null,
                currentAppInstanceId: null,
                currentAppDisplayName: null,
                note: NO_DEFAULT_APP_MESSAGE,
              }
            );
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
          const refreshed =
            (currentState.currentAppId &&
              (await fetchActiveAppInstance(currentState.currentAppId))) ||
            (await fetchDefaultAppInstance());

          if (refreshed && refreshed.instance_id) {
            set({
              currentAppId: refreshed.instance_id,
              currentAppInstance: refreshed,
              isLoadingAppId: false,
              lastValidatedAt: Date.now(), // Set validation timestamp
              errorLoadingAppId: null,
            });
          } else {
            set({
              isLoadingAppId: false,
              errorLoadingAppId: NO_DEFAULT_APP_MESSAGE,
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
            const specificInstance = await fetchActiveAppInstance(targetAppId);
            if (!specificInstance) {
              throw new Error(
                `Specified app instance not found: ${targetAppId}`
              );
            }

            targetInstance = specificInstance;
          } else {
            const currentInstance = currentState.currentAppId
              ? await fetchActiveAppInstance(currentState.currentAppId)
              : null;

            if (!currentInstance) {
              // Current app does not exist, fallback to default provider's default app
              logCurrentAppDebugSnapshot(
                '[CurrentAppDebug] CurrentAppStore validation fallback to default',
                {
                  source: 'lib/stores/current-app-store.ts',
                  currentAppId: currentState.currentAppId,
                  currentAppInstanceId:
                    currentState.currentAppInstance?.instance_id ?? null,
                  currentAppDisplayName:
                    currentState.currentAppInstance?.display_name ?? null,
                  note: 'current app instance missing during validation; falling back to default app',
                }
              );
              const defaultInstance = await fetchDefaultAppInstance();

              if (!defaultInstance) {
                set({
                  currentAppId: null,
                  currentAppInstance: null,
                  errorLoadingAppId: NO_DEFAULT_APP_MESSAGE,
                });
                return;
              }

              targetInstance = defaultInstance;
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
              clearDifyConfigCacheClient(currentState.currentAppId);
            }
            if (targetInstance.instance_id !== currentState.currentAppId) {
              clearDifyConfigCacheClient(targetInstance.instance_id);
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
          const targetInstance = await fetchActiveAppInstance(appId);

          if (!targetInstance) {
            throw new Error(`App instance not found: ${appId}`);
          }

          // Clear old config cache
          const currentState = get();
          if (currentState.currentAppId) {
            clearDifyConfigCacheClient(currentState.currentAppId);
          }
          clearDifyConfigCacheClient(appId);

          // Update state
          set({
            currentAppId: targetInstance.instance_id,
            currentAppInstance: targetInstance,
            isLoadingAppId: false,
            errorLoadingAppId: null,
            lastValidatedAt: Date.now(),
          });

          console.log(
            `[switchToApp] Successfully switched to app: ${appId}, provider: ${targetInstance.provider?.name}`
          );
          logCurrentAppDebugSnapshot(
            '[CurrentAppDebug] CurrentAppStore switchToApp success',
            {
              source: 'lib/stores/current-app-store.ts',
              currentAppId: targetInstance.instance_id,
              currentAppInstanceId: targetInstance.instance_id,
              currentAppDisplayName: targetInstance.display_name ?? null,
              note: 'switchToApp succeeded',
              extra: {
                requestedAppId: appId,
                providerName: targetInstance.provider?.name ?? null,
              },
            }
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(`[switchToApp] Failed to switch app:`, error);
          const currentState = get();
          logCurrentAppDebugSnapshot(
            '[CurrentAppDebug] CurrentAppStore switchToApp failed',
            {
              source: 'lib/stores/current-app-store.ts',
              currentAppId: currentState.currentAppId,
              currentAppInstanceId:
                currentState.currentAppInstance?.instance_id ?? null,
              currentAppDisplayName:
                currentState.currentAppInstance?.display_name ?? null,
              note: 'switchToApp failed',
              extra: {
                requestedAppId: appId,
                error: errorMessage,
              },
            }
          );
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
      onRehydrateStorage: () => (state, error) => {
        logCurrentAppDebugSnapshot(
          '[CurrentAppDebug] CurrentAppStore rehydrated',
          {
            source: 'lib/stores/current-app-store.ts',
            currentAppId: state?.currentAppId ?? null,
            currentAppInstanceId:
              state?.currentAppInstance?.instance_id ?? null,
            currentAppDisplayName:
              state?.currentAppInstance?.display_name ?? null,
            note: error
              ? 'persist rehydrate failed'
              : 'persist rehydrate completed',
            extra: error
              ? {
                  error: error instanceof Error ? error.message : String(error),
                }
              : undefined,
          }
        );
      },
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
