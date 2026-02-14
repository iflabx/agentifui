/**
 * Hook for current app context.
 *
 * Provides convenient access and management for the currently selected app instance.
 */
import { useCurrentAppStore } from '@lib/stores/current-app-store';
import type { ServiceInstance } from '@lib/types/database';

import { useCallback } from 'react';

/**
 * Hook to use the current app.
 * @returns State and actions for the current app.
 */
export function useCurrentApp() {
  const {
    currentAppId,
    currentAppInstance,
    isLoadingAppId,
    errorLoadingAppId,
    isValidating, // validation state
    isValidatingForMessage, // validation state when sending message
    setCurrentAppId,
    clearCurrentApp,
    initializeDefaultAppId,
    refreshCurrentApp,
    validateAndRefreshConfig, // validate and refresh config
    switchToApp, // switch app
  } = useCurrentAppStore();

  // Wrap switch app action for better type safety and error handling
  const switchApp = useCallback(
    (appId: string, instance: ServiceInstance) => {
      if (!appId || !instance) {
        console.error('Switch app failed: appId and instance are required');
        return;
      }
      setCurrentAppId(appId, instance);
    },
    [setCurrentAppId]
  );

  const resetApp = useCallback(() => {
    clearCurrentApp();
  }, [clearCurrentApp]);

  const initializeApp = useCallback(async () => {
    try {
      // Security check: only initialize app if user is logged in
      const { getCurrentUser } = await import(
        '@lib/auth/better-auth/http-client'
      );
      const user = await getCurrentUser();

      if (!user) {
        console.log(
          '[useCurrentApp] User not logged in, skip app initialization'
        );
        return;
      }

      await initializeDefaultAppId();
    } catch (error) {
      console.error('Failed to initialize app:', error);
    }
  }, [initializeDefaultAppId]);

  const refreshApp = useCallback(async () => {
    try {
      await refreshCurrentApp();
    } catch (error) {
      console.error('Failed to refresh app:', error);
    }
  }, [refreshCurrentApp]);

  /**
   * Force wait for app config to be ready.
   * Solves timing issues: ensures config is fully loaded before using appId.
   * Supports switching to a specific app.
   */
  const ensureAppReady = useCallback(
    async (
      targetAppId?: string
    ): Promise<{
      appId: string;
      instance: ServiceInstance;
    }> => {
      console.log(
        `[ensureAppReady] Start ensuring app config is ready${targetAppId ? `, target app: ${targetAppId}` : ''}`
      );

      // First, validate config to ensure sync with database
      if (
        currentAppId &&
        currentAppInstance &&
        !isLoadingAppId &&
        !targetAppId
      ) {
        console.log('[ensureAppReady] Validating config...');
        try {
          await validateAndRefreshConfig(undefined, 'general'); // general validation, do not trigger message spinner

          // After validation, get updated state
          const updatedState = useCurrentAppStore.getState();
          if (updatedState.currentAppId && updatedState.currentAppInstance) {
            console.log(
              `[ensureAppReady] Config validated, returning: ${updatedState.currentAppId}`
            );
            return {
              appId: updatedState.currentAppId,
              instance: updatedState.currentAppInstance,
            };
          }
        } catch (error) {
          console.warn(
            '[ensureAppReady] Config validation failed, using current config:',
            error
          );
          // If validation fails, still use current config to avoid blocking user
          return {
            appId: currentAppId,
            instance: currentAppInstance,
          };
        }
      }

      // If targetAppId is specified and different from current, switch to target app
      if (targetAppId && targetAppId !== currentAppId) {
        console.log(`[ensureAppReady] Switching to target app: ${targetAppId}`);
        try {
          await validateAndRefreshConfig(targetAppId, 'switch'); // context: switch

          // After switch, get updated state
          const updatedState = useCurrentAppStore.getState();
          if (updatedState.currentAppId && updatedState.currentAppInstance) {
            console.log(
              `[ensureAppReady] App switched, returning: ${updatedState.currentAppId}`
            );
            return {
              appId: updatedState.currentAppId,
              instance: updatedState.currentAppInstance,
            };
          } else {
            throw new Error(
              `State error after switching to app ${targetAppId}`
            );
          }
        } catch (error) {
          console.error(
            `[ensureAppReady] Failed to switch to app ${targetAppId}:`,
            error
          );
          throw new Error(
            `Failed to switch to app ${targetAppId}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // If loading, wait for loading to complete (max 10 seconds)
      if (isLoadingAppId) {
        console.log('[ensureAppReady] Loading in progress, waiting...');

        const maxWaitTime = 10000; // 10 seconds
        const pollInterval = 100; // 100ms
        let waitedTime = 0;

        while (waitedTime < maxWaitTime) {
          const currentState = useCurrentAppStore.getState();

          // Loading complete and valid config
          if (
            !currentState.isLoadingAppId &&
            currentState.currentAppId &&
            currentState.currentAppInstance
          ) {
            console.log(
              `[ensureAppReady] Wait complete, got config: ${currentState.currentAppId}`
            );
            return {
              appId: currentState.currentAppId,
              instance: currentState.currentAppInstance,
            };
          }

          // Loading complete but failed
          if (!currentState.isLoadingAppId && currentState.errorLoadingAppId) {
            console.error(
              `[ensureAppReady] Loading failed: ${currentState.errorLoadingAppId}`
            );
            throw new Error(
              `App config loading failed: ${currentState.errorLoadingAppId}`
            );
          }

          // Continue waiting
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          waitedTime += pollInterval;
        }

        throw new Error('App config loading timeout');
      }

      // If no config and not loading, initialize
      if (!currentAppId) {
        console.log('[ensureAppReady] No config, start initializing...');

        try {
          await initializeDefaultAppId();

          // After initialization, check again
          const finalState = useCurrentAppStore.getState();
          if (finalState.currentAppId && finalState.currentAppInstance) {
            console.log(
              `[ensureAppReady] Initialization success: ${finalState.currentAppId}`
            );
            return {
              appId: finalState.currentAppId,
              instance: finalState.currentAppInstance,
            };
          } else {
            throw new Error(
              `No valid config after initialization: ${finalState.errorLoadingAppId || 'Unknown error'}`
            );
          }
        } catch (error) {
          console.error('[ensureAppReady] Initialization failed:', error);
          throw new Error(
            `App config initialization failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // If there is an error, throw
      if (errorLoadingAppId) {
        throw new Error(`App config error: ${errorLoadingAppId}`);
      }

      // Should not reach here
      throw new Error(
        'App config state error: failed to get valid app config, please check if a default Dify app instance exists in the database'
      );
    },
    [
      currentAppId,
      currentAppInstance,
      isLoadingAppId,
      errorLoadingAppId,
      initializeDefaultAppId,
      validateAndRefreshConfig,
    ]
  );

  /**
   * Convenient method to switch to a specific app.
   */
  const switchToSpecificApp = useCallback(
    async (appId: string) => {
      try {
        await switchToApp(appId);
      } catch (error) {
        console.error('Failed to switch app:', error);
        throw error;
      }
    },
    [switchToApp]
  );

  return {
    // State
    currentAppId,
    currentAppInstance,
    isLoading: isLoadingAppId,
    isValidating, // validation state
    isValidatingForMessage, // validation state for message sending
    error: errorLoadingAppId,

    // Computed properties
    hasCurrentApp: !!currentAppId && !!currentAppInstance,
    isReady: !isLoadingAppId && !!currentAppId,

    // Actions
    switchApp,
    resetApp,
    initializeApp,
    refreshApp,
    ensureAppReady, // ensure app config is ready
    switchToSpecificApp, // switch to a specific app
    validateConfig: validateAndRefreshConfig, // expose validation method
  };
}

/**
 * Hook to get only the current app ID (performance optimization).
 * @returns Current app ID.
 */
export function useCurrentAppId() {
  return useCurrentAppStore(state => state.currentAppId);
}

/**
 * Hook to get only the current app instance (performance optimization).
 * @returns Current app instance.
 */
export function useCurrentAppInstance() {
  return useCurrentAppStore(state => state.currentAppInstance);
}

/**
 * Hook to get only the loading state (performance optimization).
 * @returns Whether the app is loading.
 */
export function useCurrentAppLoading() {
  return useCurrentAppStore(state => state.isLoadingAppId);
}

/**
 * Hook to get only the error state (performance optimization).
 * @returns Error message.
 */
export function useCurrentAppError() {
  return useCurrentAppStore(state => state.errorLoadingAppId);
}
