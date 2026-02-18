import { queryRowsWithPgSystemContext } from '@lib/server/pg/user-context';
import { requireAdmin } from '@lib/services/admin/require-admin';

import { NextResponse } from 'next/server';

/**
 * Admin Users API Route
 *
 * Handle admin user management related API requests
 * Get user list (simplified version, for user selection in group management)
 */
export async function GET(request: Request) {
  try {
    const authResult = await requireAdmin(request.headers);
    if (!authResult.ok) return authResult.response;

    const users = await queryRowsWithPgSystemContext<{
      id: string;
      full_name: string | null;
      username: string | null;
      avatar_url: string | null;
      role: string | null;
      status: string | null;
    }>(
      `
      SELECT id, full_name, username, avatar_url, role, status
      FROM profiles
      WHERE status = 'active'
      ORDER BY full_name ASC NULLS LAST, username ASC NULLS LAST, created_at DESC
      `
    );

    // format user data, prioritize showing real name
    const formattedUsers = (users || []).map(
      (user: (typeof users)[number]) => ({
        id: user.id,
        full_name: user.full_name || user.username || 'Unknown user',
        username: user.username,
        avatar_url: user.avatar_url,
        role: user.role,
        status: user.status,
      })
    );

    return NextResponse.json({
      users: formattedUsers,
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
