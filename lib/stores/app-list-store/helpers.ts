import type { DifyAppParametersResponse } from '@lib/services/dify/types';
import type { AppVisibility } from '@lib/types/database';

import type { AppInfo, AppParametersCache, UserAccessibleApp } from './types';

export const CACHE_DURATION = 30 * 60 * 1000;

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function toAppInfo(userApp: UserAccessibleApp): AppInfo {
  return {
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
  };
}

export function dedupeAccessibleApps(apps: UserAccessibleApp[]): AppInfo[] {
  const appMap = new Map<string, AppInfo>();

  apps.forEach(app => {
    if (!appMap.has(app.service_instance_id)) {
      appMap.set(app.service_instance_id, toAppInfo(app));
    }
  });

  return Array.from(appMap.values());
}

export function normalizeAdminApps(apps: AppInfo[]): AppInfo[] {
  return apps.map(app => ({
    ...app,
    visibility: (app.visibility as AppVisibility) || 'public',
  }));
}

export function isCacheValid(
  lastFetchTime: number,
  itemCount: number,
  now: number
): boolean {
  return now - lastFetchTime < CACHE_DURATION && itemCount > 0;
}

export function createUserScopedReset(userId: string) {
  return {
    apps: [],
    lastFetchTime: 0,
    currentUserId: userId,
    isLoading: true,
    error: null,
    parametersCache: {},
    lastParametersFetchTime: 0,
    parametersError: null,
    fetchingApps: new Set<string>(),
  };
}

export function createClearedParameterState() {
  return {
    parametersCache: {},
    lastParametersFetchTime: 0,
    parametersError: null,
    fetchingApps: new Set<string>(),
  };
}

export function getFreshCachedParameters(
  parametersCache: AppParametersCache,
  appId: string,
  now: number
): DifyAppParametersResponse | null {
  const cached = parametersCache[appId];
  if (!cached) {
    return null;
  }

  if (now - cached.timestamp > CACHE_DURATION) {
    return null;
  }

  return cached.data;
}
