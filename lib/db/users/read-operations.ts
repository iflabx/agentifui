import type { Profile } from '@lib/types/database';
import { type Result, failure, success } from '@lib/types/result';

import { callInternalDataAction } from '../internal-data-api';
import {
  buildUserFilterWhereClause,
  loadGroupsByUserIdMap,
  toEnhancedUser,
} from './query-helpers';
import { IS_BROWSER, getPool, queryRowsWithActorContext } from './shared';
import {
  type EnhancedUser,
  USER_SORT_COLUMN_MAP,
  type UserFilters,
  type UserStats,
} from './types';

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
