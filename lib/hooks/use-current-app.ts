/**
 * Hook for current app context.
 *
 * Provides convenient access and management for the currently selected app instance.
 */
import {
  fetchActiveAppInstance,
  useCurrentAppStore,
} from '@lib/stores/current-app-store';
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
      const { getCurrentUser } =
        await import('@lib/auth/better-auth/http-client');
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
   * Resolve the captured app configuration without changing the selection.
   */
  const ensureAppReady = useCallback(
    async (
      targetAppId?: string
    ): Promise<{
      appId: string;
      instance: ServiceInstance;
    }> => {
      let capturedAppId =
        targetAppId || useCurrentAppStore.getState().currentAppId;
      if (!capturedAppId) {
        await initializeDefaultAppId();
        capturedAppId = useCurrentAppStore.getState().currentAppId;
      }
      if (!capturedAppId) throw new Error('No app configuration available');
      const instance = await fetchActiveAppInstance(capturedAppId);
      if (!instance || instance.instance_id !== capturedAppId) {
        throw new Error(`App config unavailable for ${capturedAppId}`);
      }
      return { appId: capturedAppId, instance };
    },
    [initializeDefaultAppId]
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
