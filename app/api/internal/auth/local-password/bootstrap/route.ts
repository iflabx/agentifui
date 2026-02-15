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
    'Failed to set fallback password';
  return { status: normalizedStatus, message };
}

async function resolveIdentity(request: Request) {
  const identity = await resolveSessionIdentity(request.headers);
  if (!identity.success) {
    console.error(
      '[InternalAuthLocalPasswordBootstrap] failed to resolve session identity:',
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

  let payload: { newPassword?: unknown } = {};
  try {
    payload = (await request.json()) as { newPassword?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const newPassword = parseNonEmptyString(payload.newPassword);
  if (!newPassword) {
    return NextResponse.json(
      { error: 'newPassword is required' },
      { status: 400 }
    );
  }

  const hasPassword = await hasCredentialPasswordByAuthUserId(
    authResult.identity.authUserId,
    {
      actorUserId: authResult.identity.userId,
    }
  );
  if (!hasPassword.success) {
    console.error(
      '[InternalAuthLocalPasswordBootstrap] failed to detect credential password:',
      hasPassword.error
    );
    return NextResponse.json(
      { error: 'Failed to detect fallback password state' },
      { status: 500 }
    );
  }

  if (hasPassword.data) {
    return NextResponse.json(
      { error: 'Fallback password already set' },
      { status: 409 }
    );
  }

  try {
    await auth.api.setPassword({
      headers: request.headers,
      body: { newPassword },
    });
  } catch (error) {
    const parsed = parseApiError(error);
    console.error(
      '[InternalAuthLocalPasswordBootstrap] failed to set fallback password:',
      error
    );
    return NextResponse.json(
      { error: parsed.message },
      { status: parsed.status }
    );
  }

  const markResult = await markFallbackPasswordUpdated(
    authResult.identity.userId,
    authResult.identity.userId,
    {
      actorUserId: authResult.identity.userId,
    }
  );
  if (!markResult.success) {
    console.error(
      '[InternalAuthLocalPasswordBootstrap] failed to write fallback password metadata:',
      markResult.error
    );
    return NextResponse.json(
      { error: 'Fallback password set but metadata update failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Fallback password set',
  });
}
