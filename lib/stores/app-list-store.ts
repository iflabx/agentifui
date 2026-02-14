import type { UserAccessibleApp } from '@lib/db/group-permissions';
import type { DifyAppParametersResponse } from '@lib/services/dify/types';
import type { AppVisibility, ServiceInstanceConfig } from '@lib/types/database';
import { create } from 'zustand';

// App information interface, includes basic info and config
// Added: provider_name field for multi-provider support
export interface AppInfo {
  id: string;
  name: string;
  instance_id: string;
  display_name?: string;
  description?: string;
  config?: ServiceInstanceConfig;
  usage_quota?: number;
  used_count?: number;
  quota_remaining?: number;
  visibility?: AppVisibility;
  provider_name?: string; // Added: provider name for multi-provider support
}

// Added: App parameters cache interface
interface AppParametersCache {
  [appId: string]: {
    data: DifyAppParametersResponse;
    timestamp: number;
  };
}

interface AppListState {
  apps: AppInfo[];
  isLoading: boolean;
  error: string | null;
  lastFetchTime: number;

  // App parameters related state
  parametersCache: AppParametersCache;
  isLoadingParameters: boolean;
  parametersError: string | null;
  lastParametersFetchTime: number;

  // Request lock to prevent concurrent requests for the same app
  fetchingApps: Set<string>;

  // User state (auto managed)
  currentUserId: string | null;

  // Core methods
  fetchApps: () => Promise<void>;
  clearCache: () => void;

  // App parameters related methods
  fetchAllAppParameters: () => Promise<void>;
  fetchAppParameters: (appId: string) => Promise<void>;
  getAppParameters: (appId: string) => DifyAppParametersResponse | null;
  clearParametersCache: () => void;

  // Permission check method
  checkAppPermission: (appInstanceId: string) => Promise<boolean>;

  // Admin only method (for admin UI)
  fetchAllApps: () => Promise<void>;
}

const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes - extend cache time to reduce selector flicker

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useAppListStore = create<AppListState>((set, get) => ({
  apps: [],
  isLoading: false, // Restore initial state to false, handle timing issues elsewhere
  error: null,
  lastFetchTime: 0,

  // App parameters related state initialization
  parametersCache: {},
  isLoadingParameters: false,
  parametersError: null,
  lastParametersFetchTime: 0,

  // Add request lock to prevent concurrent requests for the same app
  fetchingApps: new Set(),

  // User state initialization
  currentUserId: null,

  fetchApps: async () => {
    const now = Date.now();
    const state = get();

    // Immediately set loading state to avoid initial flicker
    if (state.apps.length === 0) {
      set({ isLoading: true });
    }

    // Fix cache pollution: get user ID first, check for user change
    const { getCurrentUser } = await import(
      '@lib/auth/better-auth/http-client'
    );
    const user = await getCurrentUser();

    if (!user) {
      throw new Error('User not logged in'); // Should not happen, middleware intercepts
    }

    // Key fix: if user ID changes, clear cache immediately
    if (state.currentUserId !== user.id) {
      // Clear user-related app cache and parameter cache
      set({
        apps: [],
        lastFetchTime: 0,
        currentUserId: user.id,
        isLoading: true,
        error: null,
        // Clear parameter cache
        parametersCache: {},
        lastParametersFetchTime: 0,
        parametersError: null,
        fetchingApps: new Set(),
      });
      console.log(
        `[AppListStore] Detected user change (${state.currentUserId} → ${user.id}), cleared all app cache`
      );
    }

    // Get state again (may have been cleared)
    const currentState = get();

    // Do not fetch again within cache duration (now user-isolated)
    if (
      now - currentState.lastFetchTime < CACHE_DURATION &&
      currentState.apps.length > 0
    ) {
      console.log(
        `[AppListStore] User ${user.id} cache still valid, skip fetch`
      );
      return;
    }

    set({ isLoading: true, error: null });

    try {
      // Use permission management API to get user accessible apps
      const { getUserAccessibleApps } = await import(
        '@lib/db/group-permissions'
      );
      const result = await getUserAccessibleApps(user.id);

      if (!result.success) {
        throw new Error(result.error.message);
      }

      // Convert UserAccessibleApp to AppInfo, use deduplication logic
      const appMap = new Map<string, AppInfo>();

      result.data.forEach((userApp: UserAccessibleApp) => {
        const appInfo: AppInfo = {
          id: userApp.service_instance_id,
          name: userApp.display_name || userApp.instance_id,
          instance_id: userApp.instance_id,
          display_name: userApp.display_name || undefined,
          description: userApp.description || undefined,
          config: userApp.config,
          usage_quota: userApp.usage_quota ?? undefined,
          used_count: userApp.used_count,
          quota_remaining: userApp.quota_remaining ?? undefined,
          visibility: userApp.visibility,
          // provider_name: userApp.provider_name // Uncomment when DB supports
        };

        // Use service_instance_id as unique key for deduplication
        if (!appMap.has(userApp.service_instance_id)) {
          appMap.set(userApp.service_instance_id, appInfo);
        }
      });

      const apps: AppInfo[] = Array.from(appMap.values());

      set({
        apps,
        isLoading: false,
        lastFetchTime: now,
        currentUserId: user.id,
      });

      console.log(
        `[AppListStore] Successfully fetched ${apps.length} user accessible apps (including group permissions)`
      );

      // Background sync: update favorite app info
      try {
        const { useFavoriteAppsStore } = await import('./favorite-apps-store');
        useFavoriteAppsStore.getState().syncWithAppList(apps);
      } catch (error) {
        console.warn('[AppListStore] Failed to sync favorite app info:', error);
      }
    } catch (error: unknown) {
      console.error('[AppListStore] Failed to fetch app list:', error);
      set({
        error: getErrorMessage(error),
        isLoading: false,
      });
    }
  },

  // Added: fetch all apps (admin use)
  fetchAllApps: async () => {
    const now = Date.now();
    const state = get();

    // Admin function also needs user isolation to avoid cache pollution
    const { getCurrentUser } = await import(
      '@lib/auth/better-auth/http-client'
    );
    const user = await getCurrentUser();

    if (!user) {
      throw new Error('User not logged in');
    }

    // If user ID changes, clear cache
    if (state.currentUserId !== user.id) {
      // In admin mode, also clear user-related cache
      set({
        apps: [],
        lastFetchTime: 0,
        currentUserId: user.id,
        isLoading: true,
        error: null,
        // Clear parameter cache
        parametersCache: {},
        lastParametersFetchTime: 0,
        parametersError: null,
        fetchingApps: new Set(),
      });
      console.log(
        `[AppListStore] fetchAllApps detected user change (${state.currentUserId} → ${user.id}), cleared all app cache`
      );
    }

    // Get state again
    const currentState = get();

    // Do not fetch again within cache duration (now user-isolated)
    if (
      now - currentState.lastFetchTime < CACHE_DURATION &&
      currentState.apps.length > 0
    ) {
      console.log(
        `[AppListStore] Admin user ${user.id} cache still valid, skip fetch`
      );
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const { getAllDifyApps } = await import('@lib/services/dify/app-service');
      const rawApps = await getAllDifyApps();

      // Add visibility info to all apps
      const apps: AppInfo[] = rawApps.map(app => ({
        ...app,
        visibility: (app.visibility as AppVisibility) || 'public',
        // provider_name: app.provider_name // Uncomment when DB supports
      }));

      set({
        apps,
        isLoading: false,
        lastFetchTime: now,
        currentUserId: user.id,
      });

      console.log(
        `[AppListStore] Successfully fetched ${apps.length} apps (including private)`
      );

      // Background sync: update favorite app info
      try {
        const { useFavoriteAppsStore } = await import('./favorite-apps-store');
        useFavoriteAppsStore.getState().syncWithAppList(apps);
      } catch (error) {
        console.warn('[AppListStore] Failed to sync favorite app info:', error);
      }
    } catch (error: unknown) {
      set({
        error: getErrorMessage(error),
        isLoading: false,
      });
    }
  },

  // Added: fetch user accessible apps (with permission filtering)
  fetchUserAccessibleApps: async (userId: string) => {
    const now = Date.now();
    const state = get();

    // If user ID changes, clear cache
    if (state.currentUserId !== userId) {
      set({
        apps: [],
        lastFetchTime: 0,
        currentUserId: userId,
      });
    }

    // Do not fetch again within cache duration
    if (now - state.lastFetchTime < CACHE_DURATION && state.apps.length > 0) {
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const { getUserAccessibleApps } = await import(
        '@lib/db/group-permissions'
      );
      const result = await getUserAccessibleApps(userId);

      if (!result.success) {
        throw new Error(result.error.message);
      }

      // Convert UserAccessibleApp to AppInfo, deduplicate
      const appMap = new Map<string, AppInfo>();

      result.data.forEach((app: UserAccessibleApp) => {
        const appInfo: AppInfo = {
          id: app.service_instance_id,
          name: app.display_name || app.instance_id,
          instance_id: app.instance_id,
          display_name: app.display_name || undefined,
          description: app.description || undefined,
          config: app.config,
          usage_quota: app.usage_quota ?? undefined,
          used_count: app.used_count,
          quota_remaining: app.quota_remaining ?? undefined,
          visibility: app.visibility,
          // provider_name: app.provider_name // Uncomment when DB supports
        };

        // Key fix: use service_instance_id as unique key for deduplication
        // If user has access in multiple departments, keep only one record to avoid React key duplication
        if (!appMap.has(app.service_instance_id)) {
          appMap.set(app.service_instance_id, appInfo);
        }
      });

      const apps: AppInfo[] = Array.from(appMap.values());

      set({
        apps,
        isLoading: false,
        lastFetchTime: now,
        currentUserId: userId,
      });

      console.log(
        `[AppListStore] Successfully fetched ${apps.length} apps accessible by user ${userId}`
      );
    } catch (error: unknown) {
      console.error(
        '[AppListStore] Failed to fetch user accessible apps:',
        error
      );
      set({
        error: getErrorMessage(error),
        isLoading: false,
      });
    }
  },

  // Check if user has access to a specific app
  checkAppPermission: async (appInstanceId: string) => {
    const state = get();

    if (!state.currentUserId) {
      console.warn(
        '[AppListStore] Tried to check app permission but user ID is not set'
      );
      return false;
    }

    try {
      const { checkUserAppPermission } = await import(
        '@lib/db/group-permissions'
      );
      const result = await checkUserAppPermission(
        state.currentUserId,
        appInstanceId
      );

      if (!result.success) {
        console.warn(
          `[AppListStore] Failed to check app permission: ${result.error.message}`
        );
        return false;
      }

      return result.data.has_access;
    } catch (error) {
      console.error(
        '[AppListStore] Exception while checking app permission:',
        error
      );
      return false;
    }
  },

  // Added: fetch parameters for all apps in batch
  fetchAllAppParameters: async () => {
    const now = Date.now();
    const state = get();

    // Check if parameter cache is still valid
    if (
      now - state.lastParametersFetchTime < CACHE_DURATION &&
      Object.keys(state.parametersCache).length > 0
    ) {
      console.log(
        '[AppListStore] App parameters cache still valid, skip fetch'
      );
      return;
    }

    // If no app list, fetch app list first
    if (state.apps.length === 0) {
      console.log('[AppListStore] App list is empty, fetching app list first');

      // Directly use fetchApps to get app list
      await get().fetchApps();
    }

    const currentApps = get().apps;
    if (currentApps.length === 0) {
      console.warn('[AppListStore] No available apps, skip parameter fetch');
      return;
    }

    set({ isLoadingParameters: true, parametersError: null });

    try {
      const { getDifyAppParameters } = await import(
        '@lib/services/dify/app-service'
      );
      const newParametersCache: AppParametersCache = {};

      console.log(
        `[AppListStore] Start batch fetching parameters for ${currentApps.length} apps`
      );

      // Fetch parameters for all apps concurrently
      const parameterPromises = currentApps.map(async app => {
        try {
          const parameters = await getDifyAppParameters(app.instance_id); // Use instance_id for API call
          newParametersCache[app.id] = {
            // Use id as cache key
            data: parameters,
            timestamp: now,
          };
          console.log(
            `[AppListStore] Successfully fetched parameters for app ${app.instance_id}`
          );
        } catch (error) {
          console.warn(
            `[AppListStore] Failed to fetch parameters for app ${app.instance_id}:`,
            error
          );
          // Failure for one app does not affect others
        }
      });

      await Promise.allSettled(parameterPromises);

      set({
        parametersCache: newParametersCache,
        isLoadingParameters: false,
        lastParametersFetchTime: now,
      });

      console.log(
        `[AppListStore] Batch fetch of app parameters complete, successfully fetched parameters for ${Object.keys(newParametersCache).length} apps`
      );
    } catch (error: unknown) {
      console.error(
        '[AppListStore] Failed to batch fetch app parameters:',
        error
      );
      set({
        parametersError: getErrorMessage(error),
        isLoadingParameters: false,
      });
    }
  },

  // Added: get parameters for a specific app (from cache)
  getAppParameters: (appId: string) => {
    const state = get();
    const cached = state.parametersCache[appId];

    if (!cached) return null;

    // Check if cache is expired
    const isExpired = Date.now() - cached.timestamp > CACHE_DURATION;
    if (isExpired) {
      // Clear expired cache
      const newCache = { ...state.parametersCache };
      delete newCache[appId];
      set({ parametersCache: newCache });
      return null;
    }

    return cached.data;
  },

  // Added: fetch parameters for a specific app (individual request)
  fetchAppParameters: async (appId: string) => {
    const state = get();

    // Prevent duplicate requests
    if (state.fetchingApps.has(appId)) {
      console.log(
        `[AppListStore] App ${appId} is already being requested, skip duplicate request`
      );
      return;
    }

    // Check cache
    const cached = state.parametersCache[appId];
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log(
        `[AppListStore] App ${appId} parameter cache is valid, skip request`
      );
      return;
    }

    // Find corresponding app info
    const app = state.apps.find(a => a.id === appId);
    if (!app) {
      console.warn(`[AppListStore] App ${appId} not found`);
      return;
    }

    // Add to request lock
    set({
      fetchingApps: new Set([...state.fetchingApps, appId]),
    });

    try {
      const { getDifyAppParameters } = await import(
        '@lib/services/dify/app-service'
      );
      const parameters = await getDifyAppParameters(app.instance_id);

      // Update cache
      const newCache = {
        ...get().parametersCache,
        [appId]: {
          data: parameters,
          timestamp: Date.now(),
        },
      };

      set({ parametersCache: newCache });
      console.log(
        `[AppListStore] Successfully fetched parameters for app ${app.instance_id}`
      );
    } catch (error) {
      console.error(
        `[AppListStore] Failed to fetch parameters for app ${app.instance_id}:`,
        error
      );
    } finally {
      // Remove from request lock
      const currentState = get();
      const newFetchingApps = new Set(currentState.fetchingApps);
      newFetchingApps.delete(appId);
      set({ fetchingApps: newFetchingApps });
    }
  },

  // Added: clear parameter cache
  clearParametersCache: () => {
    set({
      parametersCache: {},
      lastParametersFetchTime: 0,
      parametersError: null,
      fetchingApps: new Set(),
    });
  },

  clearCache: () => {
    set({
      apps: [],
      lastFetchTime: 0,
      error: null,
      // Clear user state
      currentUserId: null,
      // Clear parameter cache
      parametersCache: {},
      lastParametersFetchTime: 0,
      parametersError: null,
      fetchingApps: new Set(),
    });
  },
}));
