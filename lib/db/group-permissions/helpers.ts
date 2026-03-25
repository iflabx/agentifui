import type { GroupAppPermission, GroupMember } from './types';

export function mapGroupMemberRow(row: Record<string, unknown>): GroupMember {
  return {
    id: String(row.id || ''),
    group_id: String(row.group_id || ''),
    user_id: String(row.user_id || ''),
    created_at: String(row.created_at || ''),
    user: row.profile_id
      ? {
          id: String(row.profile_id),
          username: (row.profile_username as string | null) || null,
          full_name: (row.profile_full_name as string | null) || null,
          email: (row.profile_email as string | null) || null,
        }
      : undefined,
  };
}

export function mapGroupPermissionRow(
  row: Record<string, unknown>
): GroupAppPermission {
  return {
    id: String(row.id || ''),
    group_id: String(row.group_id || ''),
    service_instance_id: String(row.service_instance_id || ''),
    is_enabled: Boolean(row.is_enabled),
    usage_quota:
      row.usage_quota === null || row.usage_quota === undefined
        ? null
        : Number(row.usage_quota),
    used_count: Number(row.used_count || 0),
    created_at: String(row.created_at || ''),
    app: row.app_id
      ? {
          id: String(row.app_id),
          display_name: (row.app_display_name as string | null) || null,
          instance_id: String(row.app_instance_id || ''),
          visibility: String(row.app_visibility || 'public'),
        }
      : undefined,
  };
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}
