import type { ServiceInstanceConfig } from '@lib/types/database';

export const IS_BROWSER = typeof window !== 'undefined';

export interface Group {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  member_count?: number;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  created_at: string;
  user?: {
    id: string;
    username: string | null;
    full_name: string | null;
    email: string | null;
  };
}

export interface GroupAppPermission {
  id: string;
  group_id: string;
  service_instance_id: string;
  is_enabled: boolean;
  usage_quota: number | null;
  used_count: number;
  created_at: string;
  app?: {
    id: string;
    display_name: string | null;
    instance_id: string;
    visibility: string;
  };
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

export interface SearchableUser {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
}
