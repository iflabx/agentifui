import { callInternalDataAction } from '@lib/db/internal-data-api';
import type { DifyAppParametersResponse } from '@lib/services/dify/types';

import type { AppInfo } from './types';

export async function fetchAllAppListForAdmin(): Promise<AppInfo[]> {
  const response = await fetch('/api/internal/apps?scope=all', {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch all apps: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    success: boolean;
    apps?: AppInfo[];
    error?: string;
  };
  if (!payload.success) {
    throw new Error(payload.error || 'Failed to fetch all apps');
  }

  return payload.apps || [];
}

export async function fetchDifyAppParametersByInstanceId(
  instanceId: string
): Promise<DifyAppParametersResponse> {
  const response = await fetch(`/api/dify/${instanceId}/parameters`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch app parameters: HTTP ${response.status}`);
  }

  return (await response.json()) as DifyAppParametersResponse;
}

export async function getAuthenticatedUserOrThrow() {
  const { getCurrentUser } = await import('@lib/auth/better-auth/http-client');
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('User not logged in');
  }

  return user;
}

export async function syncFavoriteAppsBestEffort(apps: AppInfo[]) {
  try {
    const { useFavoriteAppsStore } = await import('../favorite-apps-store');
    useFavoriteAppsStore.getState().syncWithAppList(apps);
  } catch (error) {
    console.warn('[AppListStore] Failed to sync favorite app info:', error);
  }
}

export async function fetchUserAccessibleAppsByUserId(userId: string) {
  return callInternalDataAction('groups.getUserAccessibleApps', {
    userId,
  });
}
