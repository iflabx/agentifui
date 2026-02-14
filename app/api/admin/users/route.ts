import { requireAdmin } from '@lib/services/admin/require-admin';

import { NextResponse } from 'next/server';

/**
 * Admin Users API Route
 *
 * Handle admin user management related API requests
 * Get user list (simplified version, for user selection in group management)
 */
export async function GET() {
  try {
    const authResult = await requireAdmin();
    if (!authResult.ok) return authResult.response;

    const supabase = authResult.supabase;

    // get user basic information (only query profiles table existing fields)
    const { data: users, error } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url, role, status')
      .eq('status', 'active') // only get active users
      .order('full_name', { ascending: true });

    if (error) {
      console.error('Failed to get user list:', error);
      return NextResponse.json(
        { error: 'Failed to get user list' },
        { status: 500 }
      );
    }

    // format user data, prioritize showing real name
    const formattedUsers = (users || []).map(user => ({
      id: user.id,
      full_name: user.full_name || user.username || 'Unknown user',
      username: user.username,
      avatar_url: user.avatar_url,
      role: user.role,
      status: user.status,
    }));

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
