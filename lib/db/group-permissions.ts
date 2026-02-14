import { Result, failure, success } from '@lib/types/result';

import { callInternalDataAction } from './internal-data-api';

const IS_BROWSER = typeof window !== 'undefined';

async function getPool() {
  const { getPgPool } = await import('@lib/server/pg/pool');
  return getPgPool();
}

// Group permission management service
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
  config: any;
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

function mapGroupMemberRow(row: Record<string, unknown>): GroupMember {
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

function mapGroupPermissionRow(
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

// Group management functions (admin only)
export async function getGroups(): Promise<Result<Group[]>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.getGroups');
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<Group>(
      `
        SELECT
          g.id::text,
          g.name,
          g.description,
          COALESCE(g.created_by::text, '') AS created_by,
          g.created_at::text,
          COUNT(gm.id)::int AS member_count
        FROM groups g
        LEFT JOIN group_members gm ON gm.group_id = g.id
        GROUP BY g.id
        ORDER BY g.created_at DESC
      `
    );

    return success(rows);
  } catch (error) {
    console.error('Exception while getting group list:', error);
    return failure(new Error('Failed to get group list'));
  }
}

export async function createGroup(data: {
  name: string;
  description?: string;
}): Promise<Result<Group>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.createGroup', { data });
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<Group>(
      `
        INSERT INTO groups (name, description)
        VALUES ($1, $2)
        RETURNING
          id::text,
          name,
          description,
          COALESCE(created_by::text, '') AS created_by,
          created_at::text
      `,
      [data.name, data.description || null]
    );

    return success(rows[0]);
  } catch (error) {
    console.error('Exception while creating group:', error);
    return failure(new Error('Failed to create group'));
  }
}

export async function updateGroup(
  groupId: string,
  data: { name?: string; description?: string }
): Promise<Result<Group>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.updateGroup', { groupId, data });
  }

  try {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (data.name !== undefined) {
      params.push(data.name);
      updates.push(`name = $${params.length}`);
    }
    if (data.description !== undefined) {
      params.push(data.description);
      updates.push(`description = $${params.length}`);
    }

    if (updates.length === 0) {
      return failure(new Error('No fields to update'));
    }

    params.push(groupId);

    const pool = await getPool();
    const { rows } = await pool.query<Group>(
      `
        UPDATE groups
        SET ${updates.join(', ')}
        WHERE id = $${params.length}::uuid
        RETURNING
          id::text,
          name,
          description,
          COALESCE(created_by::text, '') AS created_by,
          created_at::text
      `,
      params
    );

    if (!rows[0]) {
      return failure(new Error('Group not found'));
    }

    return success(rows[0]);
  } catch (error) {
    console.error('Exception while updating group:', error);
    return failure(new Error('Failed to update group'));
  }
}

export async function deleteGroup(groupId: string): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.deleteGroup', { groupId });
  }

  try {
    const pool = await getPool();
    await pool.query(`DELETE FROM groups WHERE id = $1::uuid`, [groupId]);
    return success(undefined);
  } catch (error) {
    console.error('Exception while deleting group:', error);
    return failure(new Error('Failed to delete group'));
  }
}

export async function getGroupMembers(
  groupId: string
): Promise<Result<GroupMember[]>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.getGroupMembers', { groupId });
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<Record<string, unknown>>(
      `
        SELECT
          gm.id::text,
          gm.group_id::text,
          gm.user_id::text,
          gm.created_at::text,
          p.id::text AS profile_id,
          p.username AS profile_username,
          p.full_name AS profile_full_name,
          p.email AS profile_email
        FROM group_members gm
        LEFT JOIN profiles p ON p.id = gm.user_id
        WHERE gm.group_id = $1::uuid
        ORDER BY gm.created_at DESC
      `,
      [groupId]
    );

    return success(rows.map(mapGroupMemberRow));
  } catch (error) {
    console.error('Exception while getting group members:', error);
    return failure(new Error('Failed to get group members'));
  }
}

export async function addGroupMember(
  groupId: string,
  userId: string
): Promise<Result<GroupMember>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.addGroupMember', { groupId, userId });
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<Record<string, unknown>>(
      `
        WITH inserted AS (
          INSERT INTO group_members (group_id, user_id)
          VALUES ($1::uuid, $2::uuid)
          RETURNING id, group_id, user_id, created_at
        )
        SELECT
          i.id::text,
          i.group_id::text,
          i.user_id::text,
          i.created_at::text,
          p.id::text AS profile_id,
          p.username AS profile_username,
          p.full_name AS profile_full_name,
          p.email AS profile_email
        FROM inserted i
        LEFT JOIN profiles p ON p.id = i.user_id
      `,
      [groupId, userId]
    );

    return success(mapGroupMemberRow(rows[0]));
  } catch (error) {
    console.error('Exception while adding group member:', error);
    return failure(new Error('Failed to add group member'));
  }
}

export async function removeGroupMember(
  groupId: string,
  userId: string
): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.removeGroupMember', {
      groupId,
      userId,
    });
  }

  try {
    const pool = await getPool();
    await pool.query(
      `
        DELETE FROM group_members
        WHERE group_id = $1::uuid
          AND user_id = $2::uuid
      `,
      [groupId, userId]
    );
    return success(undefined);
  } catch (error) {
    console.error('Exception while removing group member:', error);
    return failure(new Error('Failed to remove group member'));
  }
}

export async function getGroupAppPermissions(
  groupId: string
): Promise<Result<GroupAppPermission[]>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.getGroupAppPermissions', { groupId });
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<Record<string, unknown>>(
      `
        SELECT
          gap.id::text,
          gap.group_id::text,
          gap.service_instance_id::text,
          gap.is_enabled,
          gap.usage_quota,
          gap.used_count,
          gap.created_at::text,
          si.id::text AS app_id,
          si.display_name AS app_display_name,
          si.instance_id AS app_instance_id,
          si.visibility AS app_visibility
        FROM group_app_permissions gap
        LEFT JOIN service_instances si ON si.id = gap.service_instance_id
        WHERE gap.group_id = $1::uuid
        ORDER BY gap.created_at DESC
      `,
      [groupId]
    );

    return success(rows.map(mapGroupPermissionRow));
  } catch (error) {
    console.error('Exception while getting group app permissions:', error);
    return failure(new Error('Failed to get group app permissions'));
  }
}

export async function setGroupAppPermission(
  groupId: string,
  serviceInstanceId: string,
  data: {
    is_enabled: boolean;
    usage_quota?: number | null;
  }
): Promise<Result<GroupAppPermission>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.setGroupAppPermission', {
      groupId,
      serviceInstanceId,
      data,
    });
  }

  try {
    if (!data.is_enabled) {
      const pool = await getPool();
      await pool.query(
        `
          DELETE FROM group_app_permissions
          WHERE group_id = $1::uuid
            AND service_instance_id = $2::uuid
        `,
        [groupId, serviceInstanceId]
      );

      return success({
        id: '',
        group_id: groupId,
        service_instance_id: serviceInstanceId,
        is_enabled: false,
        usage_quota: null,
        used_count: 0,
        created_at: new Date().toISOString(),
      });
    }

    const pool = await getPool();
    const { rows } = await pool.query<Record<string, unknown>>(
      `
        WITH upserted AS (
          INSERT INTO group_app_permissions (
            group_id,
            service_instance_id,
            is_enabled,
            usage_quota
          )
          VALUES ($1::uuid, $2::uuid, TRUE, $3::integer)
          ON CONFLICT (group_id, service_instance_id)
          DO UPDATE
            SET is_enabled = EXCLUDED.is_enabled,
                usage_quota = EXCLUDED.usage_quota
          RETURNING *
        )
        SELECT
          u.id::text,
          u.group_id::text,
          u.service_instance_id::text,
          u.is_enabled,
          u.usage_quota,
          u.used_count,
          u.created_at::text,
          si.id::text AS app_id,
          si.display_name AS app_display_name,
          si.instance_id AS app_instance_id,
          si.visibility AS app_visibility
        FROM upserted u
        LEFT JOIN service_instances si ON si.id = u.service_instance_id
      `,
      [groupId, serviceInstanceId, data.usage_quota ?? null]
    );

    return success(mapGroupPermissionRow(rows[0]));
  } catch (error) {
    console.error('Exception while setting group app permission:', error);
    return failure(new Error('Failed to set group app permission'));
  }
}

export async function removeGroupAppPermission(
  groupId: string,
  serviceInstanceId: string
): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.removeGroupAppPermission', {
      groupId,
      serviceInstanceId,
    });
  }

  try {
    const pool = await getPool();
    await pool.query(
      `
        DELETE FROM group_app_permissions
        WHERE group_id = $1::uuid
          AND service_instance_id = $2::uuid
      `,
      [groupId, serviceInstanceId]
    );
    return success(undefined);
  } catch (error) {
    console.error('Exception while deleting group app permission:', error);
    return failure(new Error('Failed to delete group app permission'));
  }
}

export async function removeAllGroupAppPermissions(
  serviceInstanceId: string
): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.removeAllGroupAppPermissions', {
      serviceInstanceId,
    });
  }

  try {
    const pool = await getPool();
    await pool.query(
      `
        DELETE FROM group_app_permissions
        WHERE service_instance_id = $1::uuid
      `,
      [serviceInstanceId]
    );
    return success(undefined);
  } catch (error) {
    console.error(
      'Exception while deleting all group app permissions for app:',
      error
    );
    return failure(
      new Error('Failed to delete all group app permissions for app')
    );
  }
}

export async function getUserAccessibleApps(
  userId: string
): Promise<Result<UserAccessibleApp[]>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.getUserAccessibleApps', { userId });
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<UserAccessibleApp>(
      `SELECT * FROM get_user_accessible_apps($1::uuid)`,
      [userId]
    );
    return success(rows || []);
  } catch (error) {
    console.error('Exception while getting user accessible apps:', error);
    return failure(new Error('Failed to get accessible apps'));
  }
}

export async function checkUserAppPermission(
  userId: string,
  serviceInstanceId: string
): Promise<Result<AppPermissionCheck>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.checkUserAppPermission', {
      userId,
      serviceInstanceId,
    });
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<AppPermissionCheck>(
      `
        SELECT
          has_access,
          quota_remaining,
          error_message
        FROM check_user_app_permission($1::uuid, $2::uuid)
        LIMIT 1
      `,
      [userId, serviceInstanceId]
    );

    const result = rows[0];
    if (!result) {
      return success({
        has_access: false,
        quota_remaining: null,
        error_message: 'Permission check failed',
      });
    }

    return success(result);
  } catch (error) {
    console.error('Exception while checking user app permission:', error);
    return failure(new Error('Permission check failed'));
  }
}

export async function incrementAppUsage(
  userId: string,
  serviceInstanceId: string,
  increment: number = 1
): Promise<
  Result<{
    success: boolean;
    new_used_count: number;
    quota_remaining: number | null;
    error_message: string | null;
  }>
> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.incrementAppUsage', {
      userId,
      serviceInstanceId,
      increment,
    });
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<{
      success: boolean;
      new_used_count: number;
      quota_remaining: number | null;
      error_message: string | null;
    }>(`SELECT * FROM increment_app_usage($1::uuid, $2::uuid, $3::integer)`, [
      userId,
      serviceInstanceId,
      increment,
    ]);

    return success(
      rows[0] || {
        success: false,
        new_used_count: 0,
        quota_remaining: null,
        error_message: 'Failed to update usage count',
      }
    );
  } catch (error) {
    console.error('Exception while incrementing app usage:', error);
    return failure(new Error('Failed to update usage count'));
  }
}

// User search functionality (for group member management)
export interface SearchableUser {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, m => `\\${m}`);
}

export async function searchUsersForGroup(
  searchTerm: string,
  excludeUserIds: string[] = []
): Promise<Result<SearchableUser[]>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.searchUsersForGroup', {
      searchTerm,
      excludeUserIds,
    });
  }

  try {
    const params: unknown[] = [];
    const clauses: string[] = [`status = 'active'`];

    if (excludeUserIds.length > 0) {
      params.push(excludeUserIds);
      clauses.push(`id <> ALL($${params.length}::uuid[])`);
    }

    if (searchTerm.trim()) {
      params.push(`%${escapeLike(searchTerm.trim())}%`);
      clauses.push(
        `(username ILIKE $${params.length} ESCAPE '\\' OR full_name ILIKE $${params.length} ESCAPE '\\' OR email ILIKE $${params.length} ESCAPE '\\')`
      );
    }

    const pool = await getPool();
    const { rows } = await pool.query<SearchableUser>(
      `
        SELECT id::text, username, full_name, email, avatar_url, role::text, status::text
        FROM profiles
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT 20
      `,
      params
    );

    return success(rows || []);
  } catch (error) {
    console.error('Exception while searching users:', error);
    return failure(new Error('Failed to search users'));
  }
}
