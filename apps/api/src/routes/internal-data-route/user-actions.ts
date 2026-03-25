import {
  queryRowsWithPgSystemContext,
  queryRowsWithPgUserContext,
} from '../../lib/pg-context';
import { loadGroupsByUserIdMap } from './domain-helpers';
import {
  escapeLikePattern,
  isIdpManagedAuthSource,
  normalizeAuthSource,
  normalizeNullableTextValue,
  parseAccountStatus,
  parsePositiveInt,
  parseUserRole,
  readBoolean,
  readObject,
  readString,
  readStringArray,
  resolveEditableProfileColumns,
  sanitizeProfileRow,
  toErrorResponse,
  toSuccessResponse,
} from './helpers';
import {
  type ApiActionResponse,
  LOCAL_USER_ACTIONS,
  PROFILE_UPDATE_COLUMNS,
  type ProfileRow,
  USER_SORT_COLUMN_MAP,
} from './types';

export async function handleUserAction(
  action: string,
  payload: Record<string, unknown> | undefined,
  actorUserId: string | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_USER_ACTIONS.has(action)) {
    return null;
  }

  if (!actorUserId) {
    return toErrorResponse('Unauthorized', 401);
  }

  if (action === 'users.getUserList') {
    const filters = readObject(payload?.filters);
    const page = Math.max(1, parsePositiveInt(filters.page, 1));
    const pageSize = Math.max(
      1,
      Math.min(parsePositiveInt(filters.pageSize, 20), 100)
    );
    const sortBy = readString(filters.sortBy) || 'created_at';
    const sortOrder =
      readString(filters.sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const sortColumn =
      USER_SORT_COLUMN_MAP[sortBy] || USER_SORT_COLUMN_MAP.created_at;

    const whereClauses: string[] = [];
    const whereParams: unknown[] = [];

    const roleFilter = parseUserRole(filters.role);
    if (roleFilter) {
      whereParams.push(roleFilter);
      whereClauses.push(`p.role = $${whereParams.length}::user_role`);
    }

    const statusFilter = parseAccountStatus(filters.status);
    if (statusFilter) {
      whereParams.push(statusFilter);
      whereClauses.push(`p.status = $${whereParams.length}::account_status`);
    }

    const authSource = readString(filters.auth_source);
    if (authSource) {
      whereParams.push(authSource);
      whereClauses.push(`p.auth_source = $${whereParams.length}`);
    }

    const search = readString(filters.search);
    if (search) {
      whereParams.push(`%${escapeLikePattern(search)}%`);
      whereClauses.push(
        `(p.full_name ILIKE $${whereParams.length} ESCAPE '\\' OR p.username ILIKE $${whereParams.length} ESCAPE '\\')`
      );
    }

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRows = await queryRowsWithPgSystemContext<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM profiles p ${whereSql}`,
      whereParams
    );
    const total = Number(countRows[0]?.total || 0);
    const offset = (page - 1) * pageSize;

    const listRows = await queryRowsWithPgSystemContext<ProfileRow>(
      `
        SELECT
          p.id::text,
          p.email,
          p.phone,
          p.full_name,
          p.username,
          p.avatar_url,
          p.role::text,
          p.status::text,
          p.auth_source,
          p.sso_provider_id::text,
          p.employee_number,
          p.created_at::text,
          p.updated_at::text,
          p.last_login::text
        FROM profiles p
        ${whereSql}
        ORDER BY ${sortColumn} ${sortOrder} NULLS LAST, p.id DESC
        LIMIT $${whereParams.length + 1}
        OFFSET $${whereParams.length + 2}
      `,
      [...whereParams, pageSize, offset]
    );

    const groupsByUser = await loadGroupsByUserIdMap(
      listRows.map(row => row.id)
    );
    const users = listRows.map(row => ({
      ...sanitizeProfileRow(row),
      groups: groupsByUser.get(row.id) || [],
    }));

    return toSuccessResponse({
      users,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  }

  if (action === 'users.getUserStats') {
    const rows = await queryRowsWithPgSystemContext<{
      totalUsers: number;
      activeUsers: number;
      suspendedUsers: number;
      pendingUsers: number;
      adminUsers: number;
      managerUsers: number;
      regularUsers: number;
      newUsersToday: number;
      newUsersThisWeek: number;
      newUsersThisMonth: number;
    }>(
      `
        SELECT
          COUNT(*)::int AS "totalUsers",
          COUNT(*) FILTER (WHERE status = 'active')::int AS "activeUsers",
          COUNT(*) FILTER (WHERE status = 'suspended')::int AS "suspendedUsers",
          COUNT(*) FILTER (WHERE status = 'pending')::int AS "pendingUsers",
          COUNT(*) FILTER (WHERE role = 'admin')::int AS "adminUsers",
          COUNT(*) FILTER (WHERE role = 'manager')::int AS "managerUsers",
          COUNT(*) FILTER (WHERE role = 'user')::int AS "regularUsers",
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS "newUsersToday",
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::int AS "newUsersThisWeek",
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')::int AS "newUsersThisMonth"
        FROM profiles
      `
    );

    return toSuccessResponse(rows[0] || {});
  }

  if (action === 'users.getUserById') {
    const userId = readString(payload?.userId);
    if (!userId) {
      return toErrorResponse('Missing userId', 400);
    }

    const rows = await queryRowsWithPgSystemContext<ProfileRow>(
      `
        SELECT
          p.id::text,
          p.email,
          p.phone,
          p.full_name,
          p.username,
          p.avatar_url,
          p.role::text,
          p.status::text,
          p.auth_source,
          p.sso_provider_id::text,
          COALESCE(pea.employee_number, p.employee_number) AS employee_number,
          p.created_at::text,
          p.updated_at::text,
          p.last_login::text,
          pea.source_issuer,
          pea.source_provider,
          pea.department_code,
          pea.department_name,
          pea.department_path,
          pea.cost_center,
          pea.job_title,
          pea.employment_type,
          pea.manager_employee_number,
          pea.manager_name,
          pea.phone_e164,
          pea.office_location,
          pea.hire_date::text,
          pea.attributes AS external_attributes,
          pea.locked AS external_locked,
          pea.synced_at::text AS external_synced_at,
          pea.last_seen_at::text AS external_last_seen_at
        FROM profiles p
        LEFT JOIN profile_external_attributes pea
          ON pea.user_id = p.id
        WHERE p.id = $1::uuid
        LIMIT 1
      `,
      [userId]
    );

    if (!rows[0]) {
      return toSuccessResponse(null);
    }

    const groupsByUser = await loadGroupsByUserIdMap([rows[0].id]);
    return toSuccessResponse({
      ...sanitizeProfileRow(rows[0]),
      groups: groupsByUser.get(rows[0].id) || [],
    });
  }

  if (action === 'users.updateUserProfile') {
    const userId = readString(payload?.userId);
    const updates = readObject(payload?.updates);
    if (!userId) {
      return toErrorResponse('Missing userId', 400);
    }

    const profileRows = await queryRowsWithPgSystemContext<{
      id: string;
      auth_source: string | null;
    }>(
      `
        SELECT id::text, auth_source
        FROM profiles
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [userId]
    );

    const currentProfile = profileRows[0];
    if (!currentProfile?.id) {
      return toErrorResponse('User profile not found', 404);
    }

    const editableColumns = resolveEditableProfileColumns(
      currentProfile.auth_source
    );
    const requestedColumns = Object.keys(updates);
    const blockedColumns = requestedColumns.filter(
      key => PROFILE_UPDATE_COLUMNS.has(key) && !editableColumns.has(key)
    );

    if (blockedColumns.length > 0) {
      return toErrorResponse(
        `Read-only fields for auth source ${normalizeAuthSource(currentProfile.auth_source)}: ${blockedColumns.join(', ')}`,
        400
      );
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    for (const [key, rawValue] of Object.entries(updates)) {
      if (!PROFILE_UPDATE_COLUMNS.has(key)) {
        continue;
      }

      if (!editableColumns.has(key)) {
        continue;
      }

      if (key === 'role') {
        const parsedRole = parseUserRole(rawValue);
        if (!parsedRole) {
          continue;
        }
        setClauses.push(`role = $${index}::user_role`);
        values.push(parsedRole);
        index += 1;
        continue;
      }

      if (key === 'status') {
        const parsedStatus = parseAccountStatus(rawValue);
        if (!parsedStatus) {
          continue;
        }
        setClauses.push(`status = $${index}::account_status`);
        values.push(parsedStatus);
        index += 1;
        continue;
      }

      if (key === 'email') {
        const normalizedEmail = normalizeNullableTextValue(rawValue);
        setClauses.push(`email = $${index}`);
        values.push(normalizedEmail ? normalizedEmail.toLowerCase() : null);
        index += 1;
        continue;
      }

      if (key === 'phone' || key === 'full_name' || key === 'username') {
        setClauses.push(`${key} = $${index}`);
        values.push(normalizeNullableTextValue(rawValue));
        index += 1;
        continue;
      }

      if (key === 'avatar_url') {
        setClauses.push(`avatar_url = $${index}`);
        values.push(normalizeNullableTextValue(rawValue));
        index += 1;
        continue;
      }
    }

    if (setClauses.length === 0) {
      return toErrorResponse('No valid fields to update', 400);
    }

    setClauses.push('updated_at = NOW()');
    values.push(userId);

    const rows = await queryRowsWithPgSystemContext<ProfileRow>(
      `
        UPDATE profiles
        SET ${setClauses.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
          id::text,
          email,
          phone,
          full_name,
          username,
          avatar_url,
          role::text,
          status::text,
          auth_source,
          sso_provider_id::text,
          employee_number,
          created_at::text,
          updated_at::text,
          last_login::text
      `,
      values
    );

    if (!rows[0]) {
      return toErrorResponse('User profile not found', 404);
    }

    return toSuccessResponse(sanitizeProfileRow(rows[0]));
  }

  if (action === 'users.deleteUser') {
    const userId = readString(payload?.userId);
    if (!userId) {
      return toErrorResponse('Missing userId', 400);
    }
    if (userId === actorUserId) {
      return toErrorResponse('cannot delete current actor', 403);
    }

    const rows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        DELETE FROM profiles
        WHERE id = $1::uuid
        RETURNING id::text
      `,
      [userId]
    );
    if (!rows[0]?.id) {
      return toErrorResponse('User not found', 404);
    }

    return toSuccessResponse(null);
  }

  if (action === 'users.createUserProfile') {
    const userId = readString(payload?.userId);
    const profileData = readObject(payload?.profileData);
    if (!userId) {
      return toErrorResponse('Missing userId', 400);
    }

    const role = parseUserRole(profileData.role) || 'user';
    const status = parseAccountStatus(profileData.status) || 'active';
    const authSource = readString(profileData.auth_source) || 'password';

    const rows = await queryRowsWithPgSystemContext<ProfileRow>(
      `
        INSERT INTO profiles (
          id,
          full_name,
          username,
          avatar_url,
          role,
          status,
          auth_source,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          $5::user_role,
          $6::account_status,
          $7,
          NOW(),
          NOW()
        )
        RETURNING
          id::text,
          email,
          phone,
          full_name,
          username,
          avatar_url,
          role::text,
          status::text,
          auth_source,
          sso_provider_id::text,
          employee_number,
          created_at::text,
          updated_at::text,
          last_login::text
      `,
      [
        userId,
        readString(profileData.full_name) || null,
        readString(profileData.username) || null,
        readString(profileData.avatar_url) || null,
        role,
        status,
        authSource,
      ]
    );

    return toSuccessResponse(rows[0] ? sanitizeProfileRow(rows[0]) : null);
  }

  if (action === 'users.batchUpdateUserStatus') {
    const userIds = readStringArray(payload?.userIds);
    const status = parseAccountStatus(payload?.status);
    if (!status) {
      return toErrorResponse('Invalid status', 400);
    }
    if (userIds.length === 0) {
      return toSuccessResponse(null);
    }

    await queryRowsWithPgSystemContext(
      `
        UPDATE profiles
        SET status = $2::account_status,
            updated_at = NOW()
        WHERE id = ANY($1::uuid[])
      `,
      [userIds, status]
    );

    return toSuccessResponse(null);
  }

  if (action === 'users.batchUpdateUserRole') {
    const userIds = readStringArray(payload?.userIds);
    const role = parseUserRole(payload?.role);
    if (!role) {
      return toErrorResponse('Invalid role', 400);
    }
    if (userIds.length === 0) {
      return toSuccessResponse(null);
    }

    await queryRowsWithPgSystemContext(
      `
        UPDATE profiles
        SET role = $2::user_role,
            updated_at = NOW()
        WHERE id = ANY($1::uuid[])
      `,
      [userIds, role]
    );

    return toSuccessResponse(null);
  }

  return null;
}
