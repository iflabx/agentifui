/**
 * Database query functions related to user management.
 * Uses PostgreSQL directly on server and internal API bridge on browser.
 */
import type { AccountStatus, Profile, UserRole } from '@lib/types/database';
import { Result, failure, success } from '@lib/types/result';

import { callInternalDataAction } from './internal-data-api';

type ProfileUpdate = Partial<Omit<Profile, 'id' | 'created_at'>>;

const IS_BROWSER = typeof window !== 'undefined';

async function getPool() {
  const { getPgPool } = await import('@lib/server/pg/pool');
  return getPgPool();
}

async function queryRowsWithActorContext<T extends object>(
  actorUserId: string | undefined,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  if (!actorUserId) {
    const pool = await getPool();
    const { rows } = await pool.query<T>(sql, params);
    return rows;
  }

  const { queryRowsWithPgUserContext } = await import(
    '@lib/server/pg/user-context'
  );
  return queryRowsWithPgUserContext<T>(actorUserId, sql, params);
}

// Extended user information, including profile and group info
export interface EnhancedUser {
  id: string;
  email?: string | null;
  phone?: string | null;
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
  created_at: string;
  updated_at: string;
  last_sign_in_at?: string | null;
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  role: UserRole;
  status: AccountStatus;
  auth_source?: string;
  sso_provider_id?: string | null;
  employee_number?: string | null;
  profile_created_at: string;
  profile_updated_at: string;
  last_login?: string | null;
  groups?: Array<{
    id: string;
    name: string;
    description?: string | null;
    joined_at: string;
  }>;
}

export interface UserStats {
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
}

export interface UserFilters {
  role?: UserRole;
  status?: AccountStatus;
  auth_source?: string;
  search?: string;
  sortBy?: 'created_at' | 'last_sign_in_at' | 'email' | 'full_name';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

const USER_SORT_COLUMN_MAP: Record<
  NonNullable<UserFilters['sortBy']>,
  string
> = {
  created_at: 'p.created_at',
  last_sign_in_at: 'p.last_login',
  email: 'p.email',
  full_name: 'p.full_name',
};

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

function buildUserFilterWhereClause(filters: UserFilters): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.role) {
    params.push(filters.role);
    clauses.push(`p.role = $${params.length}`);
  }

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`p.status = $${params.length}`);
  }

  if (filters.auth_source) {
    params.push(filters.auth_source);
    clauses.push(`p.auth_source = $${params.length}`);
  }

  if (filters.search?.trim()) {
    params.push(`%${escapeLikePattern(filters.search.trim())}%`);
    clauses.push(
      `(p.full_name ILIKE $${params.length} ESCAPE '\\' OR p.username ILIKE $${params.length} ESCAPE '\\')`
    );
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function toEnhancedUser(
  profile: Profile,
  groups: EnhancedUser['groups']
): EnhancedUser {
  return {
    id: profile.id,
    email: profile.email || null,
    phone: profile.phone || null,
    email_confirmed_at: null,
    phone_confirmed_at: null,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
    last_sign_in_at: profile.last_login,
    full_name: profile.full_name || null,
    username: profile.username || null,
    avatar_url: profile.avatar_url || null,
    role: profile.role,
    status: profile.status,
    auth_source: profile.auth_source,
    sso_provider_id: profile.sso_provider_id,
    employee_number: profile.employee_number || null,
    profile_created_at: profile.created_at,
    profile_updated_at: profile.updated_at,
    last_login: profile.last_login,
    groups,
  };
}

async function loadGroupsByUserIdMap(userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, NonNullable<EnhancedUser['groups']>>();
  }

  const pool = await getPool();
  const { rows } = await pool.query<{
    user_id: string;
    joined_at: string;
    group_id: string;
    group_name: string;
    group_description: string | null;
  }>(
    `
      SELECT
        gm.user_id,
        gm.created_at::text AS joined_at,
        g.id::text AS group_id,
        g.name AS group_name,
        g.description AS group_description
      FROM group_members gm
      INNER JOIN groups g ON g.id = gm.group_id
      WHERE gm.user_id = ANY($1::uuid[])
      ORDER BY gm.created_at DESC
    `,
    [userIds]
  );

  const groupsByUser = new Map<string, NonNullable<EnhancedUser['groups']>>();
  rows.forEach(row => {
    const current = groupsByUser.get(row.user_id) || [];
    current.push({
      id: row.group_id,
      name: row.group_name,
      description: row.group_description,
      joined_at: row.joined_at,
    });
    groupsByUser.set(row.user_id, current);
  });

  return groupsByUser;
}

/**
 * Get user list.
 */
export async function getUserList(filters: UserFilters = {}): Promise<
  Result<{
    users: EnhancedUser[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }>
> {
  if (IS_BROWSER) {
    return callInternalDataAction('users.getUserList', { filters });
  }

  try {
    const page = Number(filters.page || 1);
    const pageSize = Number(filters.pageSize || 20);
    const sortBy = filters.sortBy || 'created_at';
    const sortOrder = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const sortColumn =
      USER_SORT_COLUMN_MAP[sortBy] || USER_SORT_COLUMN_MAP.created_at;

    const pool = await getPool();
    const where = buildUserFilterWhereClause(filters);

    const countQuery = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM profiles p ${where.sql}`,
      where.params
    );
    const total = Number(countQuery.rows[0]?.total || 0);

    const limitParamIndex = where.params.length + 1;
    const offsetParamIndex = where.params.length + 2;
    const offset = Math.max(0, (page - 1) * pageSize);
    const userRows = await pool.query<Profile>(
      `
        SELECT p.*
        FROM profiles p
        ${where.sql}
        ORDER BY ${sortColumn} ${sortOrder} NULLS LAST, p.id DESC
        LIMIT $${limitParamIndex}
        OFFSET $${offsetParamIndex}
      `,
      [...where.params, pageSize, offset]
    );

    const profiles = userRows.rows || [];
    const groupsByUser = await loadGroupsByUserIdMap(profiles.map(p => p.id));
    const enhancedUsers = profiles.map(profile =>
      toEnhancedUser(profile, groupsByUser.get(profile.id) || [])
    );

    return success({
      users: enhancedUsers,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error('Exception while getting user list:', error);
    return failure(
      error instanceof Error ? error : new Error('Failed to get user list')
    );
  }
}

/**
 * Get user statistics.
 */
export async function getUserStats(
  actorUserId?: string
): Promise<Result<UserStats>> {
  if (IS_BROWSER) {
    return callInternalDataAction('users.getUserStats');
  }

  try {
    if (actorUserId) {
      const rows = await queryRowsWithActorContext<{ payload: UserStats }>(
        actorUserId,
        `SELECT get_user_stats() AS payload`
      );
      return success(rows[0]?.payload || ({} as UserStats));
    }

    const pool = await getPool();
    const { rows } = await pool.query<UserStats>(
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

    return success(rows[0]);
  } catch (error) {
    console.error('Exception while getting user statistics:', error);
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to get user statistics')
    );
  }
}

/**
 * Get detailed information for a single user.
 */
export async function getUserById(
  userId: string,
  actorUserId?: string
): Promise<Result<EnhancedUser | null>> {
  if (IS_BROWSER) {
    return callInternalDataAction('users.getUserById', { userId });
  }

  try {
    if (actorUserId) {
      const adminCheckRows = await queryRowsWithActorContext<{ id: string }>(
        actorUserId,
        `SELECT id::text FROM get_user_detail_for_admin($1::uuid) LIMIT 1`,
        [userId]
      );
      if (!adminCheckRows[0]) {
        return success(null);
      }
    }

    const pool = await getPool();
    const { rows } = await pool.query<Profile>(
      `SELECT * FROM profiles WHERE id = $1::uuid LIMIT 1`,
      [userId]
    );

    const profile = rows[0];
    if (!profile) {
      return success(null);
    }

    const groupsByUser = await loadGroupsByUserIdMap([profile.id]);
    return success(toEnhancedUser(profile, groupsByUser.get(profile.id) || []));
  } catch (error) {
    console.error('Exception while getting user info:', error);
    return failure(
      error instanceof Error ? error : new Error('Failed to get user info')
    );
  }
}

function buildUpdateSetClause(
  updates: Record<string, unknown>,
  startIndex: number = 1
): { clause: string; values: unknown[] } {
  const entries = Object.entries(updates).filter(
    ([, value]) => value !== undefined
  );
  const setClauses = entries.map(
    ([column], index) => `${column} = $${startIndex + index}`
  );
  const values = entries.map(([, value]) => value);
  return {
    clause: setClauses.join(', '),
    values,
  };
}

/**
 * Update user profile.
 */
export async function updateUserProfile(
  userId: string,
  updates: Partial<ProfileUpdate>
): Promise<Result<Profile>> {
  if (IS_BROWSER) {
    return callInternalDataAction('users.updateUserProfile', {
      userId,
      updates,
    });
  }

  try {
    const updateData = {
      ...updates,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>;
    const setClause = buildUpdateSetClause(updateData, 1);
    if (!setClause.clause) {
      return failure(new Error('No valid fields to update'));
    }

    const pool = await getPool();
    const { rows } = await pool.query<Profile>(
      `
        UPDATE profiles
        SET ${setClause.clause}
        WHERE id = $${setClause.values.length + 1}::uuid
        RETURNING *
      `,
      [...setClause.values, userId]
    );

    const profile = rows[0];
    if (!profile) {
      return failure(new Error('User profile not found'));
    }

    return success(profile);
  } catch (error) {
    console.error('Exception while updating user profile:', error);
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to update user profile')
    );
  }
}

/**
 * Update user role.
 */
export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<Result<Profile>> {
  return updateUserProfile(userId, { role });
}

/**
 * Update user status.
 */
export async function updateUserStatus(
  userId: string,
  status: AccountStatus
): Promise<Result<Profile>> {
  return updateUserProfile(userId, { status });
}

/**
 * Delete user.
 */
export async function deleteUser(
  userId: string,
  actorUserId?: string
): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('users.deleteUser', { userId });
  }

  try {
    if (actorUserId) {
      const rows = await queryRowsWithActorContext<{ deleted: boolean }>(
        actorUserId,
        `SELECT safe_delete_user($1::uuid) AS deleted`,
        [userId]
      );
      if (!rows[0]?.deleted) {
        return failure(new Error('User not found'));
      }
      return success(undefined);
    }

    const pool = await getPool();
    const result = await pool.query(
      `DELETE FROM profiles WHERE id = $1::uuid`,
      [userId]
    );

    if (!result.rowCount) {
      return failure(new Error('User not found'));
    }

    return success(undefined);
  } catch (error) {
    console.error('Exception while deleting user:', error);
    return failure(
      error instanceof Error ? error : new Error('Failed to delete user')
    );
  }
}

/**
 * Create new user profile.
 */
export async function createUserProfile(
  userId: string,
  profileData: {
    full_name?: string;
    username?: string;
    avatar_url?: string;
    role?: UserRole;
    status?: AccountStatus;
    auth_source?: string;
  }
): Promise<Result<Profile>> {
  if (IS_BROWSER) {
    return callInternalDataAction('users.createUserProfile', {
      userId,
      profileData,
    });
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<Profile>(
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
          COALESCE($5::user_role, 'user'),
          COALESCE($6::account_status, 'active'),
          COALESCE($7, 'password'),
          NOW(),
          NOW()
        )
        RETURNING *
      `,
      [
        userId,
        profileData.full_name || null,
        profileData.username || null,
        profileData.avatar_url || null,
        profileData.role || null,
        profileData.status || null,
        profileData.auth_source || null,
      ]
    );

    return success(rows[0]);
  } catch (error) {
    console.error('Exception while creating user profile:', error);
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to create user profile')
    );
  }
}

/**
 * Batch update user status.
 */
export async function batchUpdateUserStatus(
  userIds: string[],
  status: AccountStatus
): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('users.batchUpdateUserStatus', {
      userIds,
      status,
    });
  }

  try {
    if (userIds.length === 0) {
      return success(undefined);
    }

    const pool = await getPool();
    await pool.query(
      `
        UPDATE profiles
        SET status = $2::account_status,
            updated_at = NOW()
        WHERE id = ANY($1::uuid[])
      `,
      [userIds, status]
    );

    return success(undefined);
  } catch (error) {
    console.error('Exception while batch updating user status:', error);
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to batch update user status')
    );
  }
}

/**
 * Batch update user role.
 */
export async function batchUpdateUserRole(
  userIds: string[],
  role: UserRole
): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('users.batchUpdateUserRole', {
      userIds,
      role,
    });
  }

  try {
    if (userIds.length === 0) {
      return success(undefined);
    }

    const pool = await getPool();
    await pool.query(
      `
        UPDATE profiles
        SET role = $2::user_role,
            updated_at = NOW()
        WHERE id = ANY($1::uuid[])
      `,
      [userIds, role]
    );

    return success(undefined);
  } catch (error) {
    console.error('Exception while batch updating user role:', error);
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to batch update user role')
    );
  }
}

// Note: Organization and department option functions have been removed, replaced by group system.
