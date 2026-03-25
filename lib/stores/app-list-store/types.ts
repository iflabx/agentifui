import type { DifyAppParametersResponse } from '@lib/services/dify/types';
import type { AppVisibility, ServiceInstanceConfig } from '@lib/types/database';

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
  provider_name?: string;
}

export interface UserAccessibleApp {
  service_instance_id: string;
  display_name: string | null;
  description: string | null;
  instance_id: string;
  api_path: string;
  visibility: 'public' | 'group_only' | 'private';
  config: ServiceInstanceConfig;
  usage_quota: number | null;
  used_count: number;
  quota_remaining: number | null;
  group_name: string | null;
}

export interface AppPermissionCheck {
  has_access: boolean;
  quota_remaining: number | null;
  error_message: string | null;
}

export interface AppParametersCache {
  [appId: string]: {
    data: DifyAppParametersResponse;
    timestamp: number;
  };
}

export interface AppListState {
  apps: AppInfo[];
  isLoading: boolean;
  error: string | null;
  lastFetchTime: number;
  parametersCache: AppParametersCache;
  isLoadingParameters: boolean;
  parametersError: string | null;
  lastParametersFetchTime: number;
  fetchingApps: Set<string>;
  currentUserId: string | null;
  fetchApps: () => Promise<void>;
  fetchUserAccessibleApps: (userId: string) => Promise<void>;
  clearCache: () => void;
  fetchAllAppParameters: () => Promise<void>;
  fetchAppParameters: (appId: string) => Promise<void>;
  getAppParameters: (appId: string) => DifyAppParametersResponse | null;
  clearParametersCache: () => void;
  checkAppPermission: (appInstanceId: string) => Promise<boolean>;
  fetchAllApps: () => Promise<void>;
}

export type AppListStoreSet = (partial: Partial<AppListState>) => void;
export type AppListStoreGet = () => AppListState;
