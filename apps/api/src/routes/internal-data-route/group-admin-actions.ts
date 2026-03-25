import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import {
  escapeLikePattern,
  parsePositiveInt,
  readBoolean,
  readObject,
  readString,
  readStringArray,
  sanitizeGroupMemberRow,
  sanitizeGroupPermissionRow,
  toErrorResponse,
  toSuccessResponse,
} from './helpers';
import {
  type ApiActionResponse,
  type GroupMemberRow,
  type GroupPermissionRow,
  type GroupRow,
  LOCAL_GROUP_ADMIN_ACTIONS,
} from './types';

export async function handleGroupAdminAction(
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_GROUP_ADMIN_ACTIONS.has(action)) {
    return null;
  }

  if (action === 'groups.getGroups') {
    const rows = await queryRowsWithPgSystemContext<GroupRow>(
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
    return toSuccessResponse(rows);
  }

  if (action === 'groups.createGroup') {
    const data = readObject(payload?.data);
    const name = readString(data.name);
    if (!name) {
      return toErrorResponse('Missing group name', 400);
    }

    const rows = await queryRowsWithPgSystemContext<GroupRow>(
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
      [name, readString(data.description) || null]
    );

    return toSuccessResponse(rows[0] || null);
  }

  if (action === 'groups.updateGroup') {
    const groupId = readString(payload?.groupId);
    const data = readObject(payload?.data);
    if (!groupId) {
      return toErrorResponse('Missing groupId', 400);
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (Object.prototype.hasOwnProperty.call(data, 'name')) {
      updates.push(`name = $${index}`);
      values.push(readString(data.name) || null);
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'description')) {
      updates.push(`description = $${index}`);
      values.push(readString(data.description) || null);
      index += 1;
    }

    if (updates.length === 0) {
      return toErrorResponse('No fields to update', 400);
    }

    values.push(groupId);
    const rows = await queryRowsWithPgSystemContext<GroupRow>(
      `
        UPDATE groups
        SET ${updates.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
          id::text,
          name,
          description,
          COALESCE(created_by::text, '') AS created_by,
          created_at::text
      `,
      values
    );

    if (!rows[0]) {
      return toErrorResponse('Group not found', 404);
    }

    return toSuccessResponse(rows[0]);
  }

  if (action === 'groups.deleteGroup') {
    const groupId = readString(payload?.groupId);
    if (!groupId) {
      return toErrorResponse('Missing groupId', 400);
    }
    await queryRowsWithPgSystemContext(
      `DELETE FROM groups WHERE id = $1::uuid`,
      [groupId]
    );
    return toSuccessResponse(null);
  }

  if (action === 'groups.getGroupMembers') {
    const groupId = readString(payload?.groupId);
    if (!groupId) {
      return toErrorResponse('Missing groupId', 400);
    }
    const rows = await queryRowsWithPgSystemContext<GroupMemberRow>(
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
    return toSuccessResponse(rows.map(sanitizeGroupMemberRow));
  }

  if (action === 'groups.addGroupMember') {
    const groupId = readString(payload?.groupId);
    const userId = readString(payload?.userId);
    if (!groupId || !userId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgSystemContext<GroupMemberRow>(
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

    return toSuccessResponse(rows[0] ? sanitizeGroupMemberRow(rows[0]) : null);
  }

  if (action === 'groups.removeGroupMember') {
    const groupId = readString(payload?.groupId);
    const userId = readString(payload?.userId);
    if (!groupId || !userId) {
      return toErrorResponse('Missing required fields', 400);
    }
    await queryRowsWithPgSystemContext(
      `
        DELETE FROM group_members
        WHERE group_id = $1::uuid
          AND user_id = $2::uuid
      `,
      [groupId, userId]
    );
    return toSuccessResponse(null);
  }

  if (action === 'groups.getGroupAppPermissions') {
    const groupId = readString(payload?.groupId);
    if (!groupId) {
      return toErrorResponse('Missing groupId', 400);
    }
    const rows = await queryRowsWithPgSystemContext<GroupPermissionRow>(
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
          si.visibility::text AS app_visibility
        FROM group_app_permissions gap
        LEFT JOIN service_instances si ON si.id = gap.service_instance_id
        WHERE gap.group_id = $1::uuid
        ORDER BY gap.created_at DESC
      `,
      [groupId]
    );
    return toSuccessResponse(rows.map(sanitizeGroupPermissionRow));
  }

  if (action === 'groups.setGroupAppPermission') {
    const groupId = readString(payload?.groupId);
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    const data = readObject(payload?.data);
    if (!groupId || !serviceInstanceId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const enabled = readBoolean(data.is_enabled, false);
    if (!enabled) {
      await queryRowsWithPgSystemContext(
        `
          DELETE FROM group_app_permissions
          WHERE group_id = $1::uuid
            AND service_instance_id = $2::uuid
        `,
        [groupId, serviceInstanceId]
      );
      return toSuccessResponse({
        id: '',
        group_id: groupId,
        service_instance_id: serviceInstanceId,
        is_enabled: false,
        usage_quota: null,
        used_count: 0,
        created_at: new Date().toISOString(),
      });
    }

    const usageQuotaRaw = data.usage_quota;
    const usageQuota =
      typeof usageQuotaRaw === 'number' && Number.isFinite(usageQuotaRaw)
        ? Math.max(0, Math.floor(usageQuotaRaw))
        : null;

    const rows = await queryRowsWithPgSystemContext<GroupPermissionRow>(
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
          si.visibility::text AS app_visibility
        FROM upserted u
        LEFT JOIN service_instances si ON si.id = u.service_instance_id
      `,
      [groupId, serviceInstanceId, usageQuota]
    );

    return toSuccessResponse(
      rows[0] ? sanitizeGroupPermissionRow(rows[0]) : null
    );
  }

  if (action === 'groups.removeGroupAppPermission') {
    const groupId = readString(payload?.groupId);
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    if (!groupId || !serviceInstanceId) {
      return toErrorResponse('Missing required fields', 400);
    }
    await queryRowsWithPgSystemContext(
      `
        DELETE FROM group_app_permissions
        WHERE group_id = $1::uuid
          AND service_instance_id = $2::uuid
      `,
      [groupId, serviceInstanceId]
    );
    return toSuccessResponse(null);
  }

  if (action === 'groups.removeAllGroupAppPermissions') {
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    if (!serviceInstanceId) {
      return toErrorResponse('Missing serviceInstanceId', 400);
    }
    await queryRowsWithPgSystemContext(
      `
        DELETE FROM group_app_permissions
        WHERE service_instance_id = $1::uuid
      `,
      [serviceInstanceId]
    );
    return toSuccessResponse(null);
  }

  if (action === 'groups.searchUsersForGroup') {
    const searchTerm = readString(payload?.searchTerm);
    const excludeUserIds = readStringArray(payload?.excludeUserIds);

    const clauses: string[] = [`status = 'active'`];
    const params: unknown[] = [];

    if (excludeUserIds.length > 0) {
      params.push(excludeUserIds);
      clauses.push(`id <> ALL($${params.length}::uuid[])`);
    }

    if (searchTerm) {
      params.push(`%${escapeLikePattern(searchTerm)}%`);
      clauses.push(
        `(username ILIKE $${params.length} ESCAPE '\\' OR full_name ILIKE $${params.length} ESCAPE '\\' OR email ILIKE $${params.length} ESCAPE '\\')`
      );
    }

    const rows = await queryRowsWithPgSystemContext<Record<string, unknown>>(
      `
        SELECT
          id::text,
          username,
          full_name,
          email,
          avatar_url,
          role::text,
          status::text
        FROM profiles
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT 20
      `,
      params
    );

    return toSuccessResponse(rows || []);
  }

  return null;
}
