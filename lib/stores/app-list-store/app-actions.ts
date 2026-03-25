import { callInternalDataAction } from '@lib/db/internal-data-api';

import {
  createUserScopedReset,
  dedupeAccessibleApps,
  getErrorMessage,
  isCacheValid,
  normalizeAdminApps,
} from './helpers';
import {
  fetchAllAppListForAdmin,
  fetchUserAccessibleAppsByUserId,
  getAuthenticatedUserOrThrow,
  syncFavoriteAppsBestEffort,
} from './shared';
import type {
  AppListStoreGet,
  AppListStoreSet,
  AppPermissionCheck,
  UserAccessibleApp,
} from './types';

export function createAppActions(set: AppListStoreSet, get: AppListStoreGet) {
  return {
    fetchApps: async () => {
      const now = Date.now();
      const state = get();

      if (state.apps.length === 0) {
        set({ isLoading: true });
      }

      const user = await getAuthenticatedUserOrThrow();

      if (state.currentUserId !== user.id) {
        set(createUserScopedReset(user.id));
        console.log(
          `[AppListStore] Detected user change (${state.currentUserId} -> ${user.id}), cleared all app cache`
        );
      }

      const currentState = get();
      if (
        isCacheValid(currentState.lastFetchTime, currentState.apps.length, now)
      ) {
        console.log(
          `[AppListStore] User ${user.id} cache still valid, skip fetch`
        );
        return;
      }

      set({ isLoading: true, error: null });

      try {
        const result = await fetchUserAccessibleAppsByUserId(user.id);

        if (!result.success) {
          throw new Error(result.error.message);
        }

        const apps = dedupeAccessibleApps(result.data as UserAccessibleApp[]);

        set({
          apps,
          isLoading: false,
          lastFetchTime: now,
          currentUserId: user.id,
        });

        console.log(
          `[AppListStore] Successfully fetched ${apps.length} user accessible apps (including group permissions)`
        );

        await syncFavoriteAppsBestEffort(apps);
      } catch (error: unknown) {
        console.error('[AppListStore] Failed to fetch app list:', error);
        set({
          error: getErrorMessage(error),
          isLoading: false,
        });
      }
    },

    fetchAllApps: async () => {
      const now = Date.now();
      const state = get();
      const user = await getAuthenticatedUserOrThrow();

      if (state.currentUserId !== user.id) {
        set(createUserScopedReset(user.id));
        console.log(
          `[AppListStore] fetchAllApps detected user change (${state.currentUserId} -> ${user.id}), cleared all app cache`
        );
      }

      const currentState = get();
      if (
        isCacheValid(currentState.lastFetchTime, currentState.apps.length, now)
      ) {
        console.log(
          `[AppListStore] Admin user ${user.id} cache still valid, skip fetch`
        );
        return;
      }

      set({ isLoading: true, error: null });

      try {
        const apps = normalizeAdminApps(await fetchAllAppListForAdmin());

        set({
          apps,
          isLoading: false,
          lastFetchTime: now,
          currentUserId: user.id,
        });

        console.log(
          `[AppListStore] Successfully fetched ${apps.length} apps (including private)`
        );

        await syncFavoriteAppsBestEffort(apps);
      } catch (error: unknown) {
        set({
          error: getErrorMessage(error),
          isLoading: false,
        });
      }
    },

    fetchUserAccessibleApps: async (userId: string) => {
      const now = Date.now();
      const state = get();

      if (state.currentUserId !== userId) {
        set({
          apps: [],
          lastFetchTime: 0,
          currentUserId: userId,
        });
      }

      const currentState = get();
      if (
        isCacheValid(currentState.lastFetchTime, currentState.apps.length, now)
      ) {
        return;
      }

      set({ isLoading: true, error: null });

      try {
        const result = await fetchUserAccessibleAppsByUserId(userId);

        if (!result.success) {
          throw new Error(result.error.message);
        }

        const apps = dedupeAccessibleApps(result.data as UserAccessibleApp[]);

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

    checkAppPermission: async (appInstanceId: string) => {
      const state = get();

      if (!state.currentUserId) {
        console.warn(
          '[AppListStore] Tried to check app permission but user ID is not set'
        );
        return false;
      }

      try {
        const result = await callInternalDataAction<AppPermissionCheck>(
          'groups.checkUserAppPermission',
          {
            userId: state.currentUserId,
            serviceInstanceId: appInstanceId,
          }
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
  };
}
