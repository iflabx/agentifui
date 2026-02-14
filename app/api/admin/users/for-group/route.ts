import { getPgPool } from '@lib/server/pg/pool';
import { requireAdmin } from '@lib/services/admin/require-admin';

import { NextRequest, NextResponse } from 'next/server';

/**
 * Admin Users for Group API Route
 *
 * Handle user pagination list request in group member management
 * Support search, pagination, and exclude existing members
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdmin(request.headers);
    if (!authResult.ok) return authResult.response;

    // parse request parameters
    const body = await request.json();
    const { page = 1, pageSize = 10, search, excludeUserIds = [] } = body;
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 10));
    const offset = (safePage - 1) * safePageSize;
    const trimmedSearch = typeof search === 'string' ? search.trim() : '';

    const pool = getPgPool();
    const whereClauses: string[] = ["status = 'active'"];
    const params: Array<string | string[] | number> = [];

    if (trimmedSearch.length > 0) {
      params.push(`%${trimmedSearch}%`);
      const searchParamIndex = params.length;
      whereClauses.push(
        `(username ILIKE $${searchParamIndex} OR full_name ILIKE $${searchParamIndex} OR email ILIKE $${searchParamIndex})`
      );
    }

    if (Array.isArray(excludeUserIds) && excludeUserIds.length > 0) {
      const sanitizedIds = excludeUserIds.filter(
        (id: unknown) => typeof id === 'string' && id.trim().length > 0
      );
      if (sanitizedIds.length > 0) {
        params.push(sanitizedIds);
        const excludeParamIndex = params.length;
        whereClauses.push(`NOT (id = ANY($${excludeParamIndex}::uuid[]))`);
      }
    }

    const whereSql = whereClauses.join(' AND ');

    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM profiles WHERE ${whereSql}`,
      params
    );
    const total = Number(countResult.rows[0]?.total || 0);

    params.push(safePageSize);
    const limitParamIndex = params.length;
    params.push(offset);
    const offsetParamIndex = params.length;

    const usersResult = await pool.query<{
      id: string;
      username: string | null;
      full_name: string | null;
      email: string | null;
      avatar_url: string | null;
      role: string | null;
      status: string | null;
    }>(
      `
      SELECT id, username, full_name, email, avatar_url, role, status
      FROM profiles
      WHERE ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
      `,
      params
    );
    const users = usersResult.rows;

    // calculate pagination information
    const totalPages = Math.ceil(total / safePageSize);

    // format user data
    const formattedUsers = (users || []).map(
      (user: (typeof users)[number]) => ({
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        avatar_url: user.avatar_url,
        role: user.role,
        status: user.status,
      })
    );

    return NextResponse.json({
      users: formattedUsers,
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages,
      success: true,
    });
  } catch (error) {
    console.error('User list API error:', error);
    return NextResponse.json(
      { error: 'Server internal error' },
      { status: 500 }
    );
  }
}
