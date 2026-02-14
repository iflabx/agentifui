import {
  hasCredentialPasswordByAuthUserId,
  markFallbackPasswordUpdated,
} from '@lib/auth/better-auth/local-login-policy';
import { auth } from '@lib/auth/better-auth/server';
import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';

import { NextResponse } from 'next/server';

type ApiErrorLike = {
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
};

export const runtime = 'nodejs';

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseApiError(error: unknown): { status: number; message: string } {
  const candidate = (error || {}) as ApiErrorLike;
  const maybeStatus = Number(candidate.status ?? candidate.statusCode);
  const normalizedStatus =
    Number.isInteger(maybeStatus) && maybeStatus >= 400 && maybeStatus <= 599
      ? maybeStatus
      : 500;
  const message =
    parseNonEmptyString(candidate.message) ||
    parseNonEmptyString(candidate.code) ||
    'Failed to change fallback password';
  return { status: normalizedStatus, message };
}

async function resolveIdentity(request: Request) {
  const identity = await resolveSessionIdentity(request.headers);
  if (!identity.success) {
    console.error(
      '[InternalAuthLocalPasswordChange] failed to resolve session identity:',
      identity.error
    );
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Failed to verify session' },
        { status: 500 }
      ),
    };
  }

  if (!identity.data) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return {
    ok: true as const,
    identity: identity.data,
  };
}

export async function POST(request: Request) {
  const authResult = await resolveIdentity(request);
  if (!authResult.ok) {
    return authResult.response;
  }

  let payload: {
    currentPassword?: unknown;
    newPassword?: unknown;
    revokeOtherSessions?: unknown;
  } = {};
  try {
    payload = (await request.json()) as {
      currentPassword?: unknown;
      newPassword?: unknown;
      revokeOtherSessions?: unknown;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const currentPassword = parseNonEmptyString(payload.currentPassword);
  const newPassword = parseNonEmptyString(payload.newPassword);

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: 'currentPassword and newPassword are required' },
      { status: 400 }
    );
  }

  const hasPassword = await hasCredentialPasswordByAuthUserId(
    authResult.identity.authUserId
  );
  if (!hasPassword.success) {
    console.error(
      '[InternalAuthLocalPasswordChange] failed to detect credential password:',
      hasPassword.error
    );
    return NextResponse.json(
      { error: 'Failed to detect fallback password state' },
      { status: 500 }
    );
  }

  if (!hasPassword.data) {
    return NextResponse.json(
      { error: 'Fallback password is not set' },
      { status: 409 }
    );
  }

  let changeResult: unknown = null;
  try {
    changeResult = await auth.api.changePassword({
      headers: request.headers,
      body: {
        currentPassword,
        newPassword,
        revokeOtherSessions:
          typeof payload.revokeOtherSessions === 'boolean'
            ? payload.revokeOtherSessions
            : undefined,
      },
    });
  } catch (error) {
    const parsed = parseApiError(error);
    console.error(
      '[InternalAuthLocalPasswordChange] failed to change fallback password:',
      error
    );
    return NextResponse.json(
      { error: parsed.message },
      { status: parsed.status }
    );
  }

  const markResult = await markFallbackPasswordUpdated(
    authResult.identity.userId,
    authResult.identity.userId
  );
  if (!markResult.success) {
    console.error(
      '[InternalAuthLocalPasswordChange] failed to write fallback password metadata:',
      markResult.error
    );
    return NextResponse.json(
      { error: 'Fallback password changed but metadata update failed' },
      { status: 500 }
    );
  }

  const token =
    changeResult &&
    typeof changeResult === 'object' &&
    typeof (changeResult as { token?: unknown }).token === 'string'
      ? ((changeResult as { token?: unknown }).token as string)
      : null;

  return NextResponse.json({
    success: true,
    message: 'Fallback password changed',
    token,
  });
}
