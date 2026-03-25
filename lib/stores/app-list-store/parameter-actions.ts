import {
  CACHE_DURATION,
  createClearedParameterState,
  getErrorMessage,
  getFreshCachedParameters,
} from './helpers';
import { fetchDifyAppParametersByInstanceId } from './shared';
import type {
  AppListStoreGet,
  AppListStoreSet,
  AppParametersCache,
} from './types';

export function createParameterActions(
  set: AppListStoreSet,
  get: AppListStoreGet
) {
  return {
    fetchAllAppParameters: async () => {
      const now = Date.now();
      const state = get();

      if (
        now - state.lastParametersFetchTime < CACHE_DURATION &&
        Object.keys(state.parametersCache).length > 0
      ) {
        console.log(
          '[AppListStore] App parameters cache still valid, skip fetch'
        );
        return;
      }

      if (state.apps.length === 0) {
        console.log(
          '[AppListStore] App list is empty, fetching app list first'
        );
        await get().fetchApps();
      }

      const currentApps = get().apps;
      if (currentApps.length === 0) {
        console.warn('[AppListStore] No available apps, skip parameter fetch');
        return;
      }

      set({ isLoadingParameters: true, parametersError: null });

      try {
        const newParametersCache: AppParametersCache = {};

        console.log(
          `[AppListStore] Start batch fetching parameters for ${currentApps.length} apps`
        );

        const parameterPromises = currentApps.map(async app => {
          try {
            const parameters = await fetchDifyAppParametersByInstanceId(
              app.instance_id
            );

            newParametersCache[app.id] = {
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

    getAppParameters: (appId: string) => {
      const state = get();
      const cachedData = getFreshCachedParameters(
        state.parametersCache,
        appId,
        Date.now()
      );

      if (cachedData) {
        return cachedData;
      }

      if (state.parametersCache[appId]) {
        const newCache = { ...state.parametersCache };
        delete newCache[appId];
        set({ parametersCache: newCache });
      }

      return null;
    },

    fetchAppParameters: async (appId: string) => {
      const state = get();

      if (state.fetchingApps.has(appId)) {
        console.log(
          `[AppListStore] App ${appId} is already being requested, skip duplicate request`
        );
        return;
      }

      const cachedData = getFreshCachedParameters(
        state.parametersCache,
        appId,
        Date.now()
      );
      if (cachedData) {
        console.log(
          `[AppListStore] App ${appId} parameter cache is valid, skip request`
        );
        return;
      }

      const app = state.apps.find(item => item.id === appId);
      if (!app) {
        console.warn(`[AppListStore] App ${appId} not found`);
        return;
      }

      set({
        fetchingApps: new Set([...state.fetchingApps, appId]),
      });

      try {
        const parameters = await fetchDifyAppParametersByInstanceId(
          app.instance_id
        );

        set({
          parametersCache: {
            ...get().parametersCache,
            [appId]: {
              data: parameters,
              timestamp: Date.now(),
            },
          },
        });
        console.log(
          `[AppListStore] Successfully fetched parameters for app ${app.instance_id}`
        );
      } catch (error) {
        console.error(
          `[AppListStore] Failed to fetch parameters for app ${app.instance_id}:`,
          error
        );
      } finally {
        const currentState = get();
        const newFetchingApps = new Set(currentState.fetchingApps);
        newFetchingApps.delete(appId);
        set({ fetchingApps: newFetchingApps });
      }
    },

    clearParametersCache: () => {
      set(createClearedParameterState());
    },
  };
}
