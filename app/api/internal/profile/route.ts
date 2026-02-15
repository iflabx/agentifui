import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { getPgPool } from '@lib/server/pg/pool';
import { publishTableChangeEvent } from '@lib/server/realtime/publisher';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const PROFILE_SELECT_SQL = `
  SELECT
    p.id::text,
    p.full_name,
    p.username,
    p.avatar_url,
    p.role::text,
    p.status::text,
    p.auth_source,
    p.sso_provider_id::text,
    p.employee_number,
    p.email,
    p.phone,
    pea.department_name AS department,
    pea.job_title,
    p.created_at::text,
    p.updated_at::text,
    p.last_login::text
  FROM profiles p
  LEFT JOIN profile_external_attributes pea
    ON pea.user_id = p.id
`;

async function resolveIdentity(request: Request) {
  const result = await resolveSessionIdentity(request.headers);
  if (!result.success) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Failed to verify session' },
        { status: 500 }
      ),
    };
  }

  if (!result.data) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      ),
    };
  }

  return { ok: true as const, identity: result.data };
}

function resolveTargetUserId(url: URL, currentUserId: string) {
  return (url.searchParams.get('userId') || '').trim() || currentUserId;
}

function canAccessTargetUser(
  targetUserId: string,
  currentUserId: string,
  currentRole: string
) {
  return targetUserId === currentUserId || currentRole === 'admin';
}

export async function GET(request: Request) {
  try {
    const auth = await resolveIdentity(request);
    if (!auth.ok) {
      return auth.response;
    }

    const url = new URL(request.url);
    const targetUserId = resolveTargetUserId(url, auth.identity.userId);
    if (
      !canAccessTargetUser(
        targetUserId,
        auth.identity.userId,
        auth.identity.role || 'user'
      )
    ) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const pool = getPgPool();
    const { rows } = await pool.query(
      `${PROFILE_SELECT_SQL} WHERE p.id = $1::uuid LIMIT 1`,
      [targetUserId]
    );

    return NextResponse.json({
      success: true,
      profile: rows[0] || null,
    });
  } catch (error) {
    console.error('[InternalProfileAPI] GET failed:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await resolveIdentity(request);
    if (!auth.ok) {
      return auth.response;
    }

    const body = (await request.json()) as {
      userId?: string;
      updates?: Record<string, unknown>;
    };

    const targetUserId = (body.userId || '').trim() || auth.identity.userId;
    if (
      !canAccessTargetUser(
        targetUserId,
        auth.identity.userId,
        auth.identity.role || 'user'
      )
    ) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const updates = body.updates || {};
    const allowedColumns = new Set(['full_name', 'username', 'avatar_url']);
    const entries = Object.entries(updates).filter(
      ([key, value]) => allowedColumns.has(key) && value !== undefined
    );

    if (entries.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const setClauses = entries.map(
      ([column], index) => `${column} = $${index + 1}`
    );
    const values = entries.map(([, value]) => value);
    values.push(new Date().toISOString());
    setClauses.push(`updated_at = $${values.length}`);
    values.push(targetUserId);

    const pool = getPgPool();
    const oldProfileResult = await pool.query(
      `${PROFILE_SELECT_SQL} WHERE p.id = $1::uuid LIMIT 1`,
      [targetUserId]
    );
    const oldProfileRow = oldProfileResult.rows[0] || null;

    const updateResult = await pool.query<{ id: string }>(
      `
        UPDATE profiles
        SET ${setClauses.join(', ')}
        WHERE id = $${values.length}::uuid
        RETURNING id::text
      `,
      values
    );

    if (!updateResult.rows[0]) {
      return NextResponse.json(
        { success: false, error: 'Profile not found' },
        { status: 404 }
      );
    }

    const profileResult = await pool.query(
      `${PROFILE_SELECT_SQL} WHERE p.id = $1::uuid LIMIT 1`,
      [targetUserId]
    );
    const newProfileRow = profileResult.rows[0] || null;

    await publishTableChangeEvent({
      table: 'profiles',
      eventType: 'UPDATE',
      oldRow: oldProfileRow,
      newRow: newProfileRow,
    }).catch(error => {
      console.warn('[InternalProfileAPI] Realtime publish failed:', error);
    });

    return NextResponse.json({
      success: true,
      profile: newProfileRow,
    });
  } catch (error) {
    console.error('[InternalProfileAPI] PATCH failed:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
