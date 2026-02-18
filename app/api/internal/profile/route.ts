import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';
import { queryRowsWithPgSystemContext } from '@lib/server/pg/user-context';
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
      response: nextApiErrorResponse({
        request,
        status: 500,
        source: 'auth',
        code: 'AUTH_VERIFY_FAILED',
        userMessage: 'Failed to verify session',
        developerMessage:
          result.error?.message ||
          'resolveSessionIdentity returned unsuccessful result',
      }),
    };
  }

  if (!result.data) {
    return {
      ok: false as const,
      response: nextApiErrorResponse({
        request,
        status: 401,
        source: 'auth',
        code: 'AUTH_UNAUTHORIZED',
        userMessage: 'Unauthorized',
      }),
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
      return nextApiErrorResponse({
        request,
        status: 403,
        source: 'auth',
        code: 'AUTH_FORBIDDEN',
        userMessage: 'Forbidden',
      });
    }

    const rows = await queryRowsWithPgSystemContext(
      `${PROFILE_SELECT_SQL} WHERE p.id = $1::uuid LIMIT 1`,
      [targetUserId]
    );

    return NextResponse.json({
      success: true,
      profile: rows[0] || null,
    });
  } catch (error) {
    console.error('[InternalProfileAPI] GET failed:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      code: 'INTERNAL_PROFILE_GET_FAILED',
      userMessage: 'Internal server error',
      developerMessage:
        error instanceof Error ? error.message : 'Unknown profile GET error',
    });
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
      return nextApiErrorResponse({
        request,
        status: 403,
        source: 'auth',
        code: 'AUTH_FORBIDDEN',
        userMessage: 'Forbidden',
      });
    }

    const updates = body.updates || {};
    const allowedColumns = new Set(['full_name', 'username', 'avatar_url']);
    const entries = Object.entries(updates).filter(
      ([key, value]) => allowedColumns.has(key) && value !== undefined
    );

    if (entries.length === 0) {
      return nextApiErrorResponse({
        request,
        status: 400,
        code: 'PROFILE_UPDATE_FIELDS_EMPTY',
        userMessage: 'No valid fields to update',
      });
    }

    const setClauses = entries.map(
      ([column], index) => `${column} = $${index + 1}`
    );
    const values = entries.map(([, value]) => value);
    values.push(new Date().toISOString());
    setClauses.push(`updated_at = $${values.length}`);
    values.push(targetUserId);

    const oldProfileRows = await queryRowsWithPgSystemContext(
      `${PROFILE_SELECT_SQL} WHERE p.id = $1::uuid LIMIT 1`,
      [targetUserId]
    );
    const oldProfileRow = oldProfileRows[0] || null;

    const updateRows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        UPDATE profiles
        SET ${setClauses.join(', ')}
        WHERE id = $${values.length}::uuid
        RETURNING id::text
      `,
      values
    );

    if (!updateRows[0]) {
      return nextApiErrorResponse({
        request,
        status: 404,
        code: 'PROFILE_NOT_FOUND',
        userMessage: 'Profile not found',
      });
    }

    const profileRows = await queryRowsWithPgSystemContext(
      `${PROFILE_SELECT_SQL} WHERE p.id = $1::uuid LIMIT 1`,
      [targetUserId]
    );
    const newProfileRow = profileRows[0] || null;

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
    return nextApiErrorResponse({
      request,
      status: 500,
      code: 'INTERNAL_PROFILE_PATCH_FAILED',
      userMessage: 'Internal server error',
      developerMessage:
        error instanceof Error ? error.message : 'Unknown profile PATCH error',
    });
  }
}
