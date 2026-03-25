import type { Profile } from '@lib/types/database';

import { getPool } from './shared';
import type { EnhancedUser, UserFilters } from './types';

export function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

export function buildUserFilterWhereClause(filters: UserFilters): {
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

export function toEnhancedUser(
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

export async function loadGroupsByUserIdMap(userIds: string[]) {
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

export function buildUpdateSetClause(
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
