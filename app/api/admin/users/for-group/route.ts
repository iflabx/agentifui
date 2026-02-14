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
    const authResult = await requireAdmin();
    if (!authResult.ok) return authResult.response;

    const supabase = authResult.supabase;

    // parse request parameters
    const body = await request.json();
    const { page = 1, pageSize = 10, search, excludeUserIds = [] } = body;

    // build query
    let query = supabase
      .from('profiles')
      .select('id, username, full_name, email, avatar_url, role, status', {
        count: 'exact',
      })
      .eq('status', 'active') // only get active users
      .order('created_at', { ascending: false });

    // exclude specified user IDs (e.g. users already in the group)
    if (excludeUserIds.length > 0) {
      query = query.not('id', 'in', `(${excludeUserIds.join(',')})`);
    }

    // search condition: username, full name or email contains search term
    if (search && search.trim()) {
      query = query.or(
        `username.ilike.%${search.trim()}%,full_name.ilike.%${search.trim()}%,email.ilike.%${search.trim()}%`
      );
    }

    // apply pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data: users, error, count } = await query;

    if (error) {
      console.error('Failed to get user list:', error);
      return NextResponse.json(
        { error: 'Failed to get user list' },
        { status: 500 }
      );
    }

    // calculate pagination information
    const total = count || 0;
    const totalPages = Math.ceil(total / pageSize);

    // format user data
    const formattedUsers = (users || []).map(user => ({
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      email: user.email,
      avatar_url: user.avatar_url,
      role: user.role,
      status: user.status,
    }));

    return NextResponse.json({
      users: formattedUsers,
      page,
      pageSize,
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
