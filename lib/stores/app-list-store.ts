import { create } from 'zustand';

import { createAppActions } from './app-list-store/app-actions';
import { createClearedParameterState } from './app-list-store/helpers';
import { createParameterActions } from './app-list-store/parameter-actions';
import type { AppListState } from './app-list-store/types';

export type {
  AppInfo,
  AppParametersCache,
  AppPermissionCheck,
} from './app-list-store/types';

export const useAppListStore = create<AppListState>((set, get) => ({
  apps: [],
  isLoading: false,
  error: null,
  lastFetchTime: 0,
  parametersCache: {},
  isLoadingParameters: false,
  parametersError: null,
  lastParametersFetchTime: 0,
  fetchingApps: new Set(),
  currentUserId: null,
  ...createAppActions(set, get),
  ...createParameterActions(set, get),
  clearCache: () => {
    set({
      apps: [],
      lastFetchTime: 0,
      error: null,
      currentUserId: null,
      ...createClearedParameterState(),
    });
  },
}));
