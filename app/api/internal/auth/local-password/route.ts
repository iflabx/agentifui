import {
  getAuthModeSetting,
  getUserLocalLoginStateByUserId,
  hasCredentialPasswordByAuthUserId,
} from '@lib/auth/better-auth/local-login-policy';
import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function resolveIdentity(request: Request) {
  const identity = await resolveSessionIdentity(request.headers);
  if (!identity.success) {
    console.error(
      '[InternalAuthLocalPassword] failed to resolve session identity:',
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

export async function GET(request: Request) {
  const auth = await resolveIdentity(request);
  if (!auth.ok) {
    return auth.response;
  }

  const [authModeResult, localStateResult, hasPasswordResult] =
    await Promise.all([
      getAuthModeSetting(),
      getUserLocalLoginStateByUserId(auth.identity.userId, {
        actorUserId: auth.identity.userId,
      }),
      hasCredentialPasswordByAuthUserId(auth.identity.authUserId, {
        actorUserId: auth.identity.userId,
      }),
    ]);

  if (!authModeResult.success) {
    console.error(
      '[InternalAuthLocalPassword] failed to read auth mode:',
      authModeResult.error
    );
    return NextResponse.json(
      { error: 'Failed to read auth mode' },
      { status: 500 }
    );
  }

  if (!localStateResult.success) {
    console.error(
      '[InternalAuthLocalPassword] failed to read local password state:',
      localStateResult.error
    );
    return NextResponse.json(
      { error: 'Failed to read local password state' },
      { status: 500 }
    );
  }

  if (!localStateResult.data) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  if (!hasPasswordResult.success) {
    console.error(
      '[InternalAuthLocalPassword] failed to detect fallback password:',
      hasPasswordResult.error
    );
    return NextResponse.json(
      { error: 'Failed to detect fallback password state' },
      { status: 500 }
    );
  }

  const state = localStateResult.data;
  const hasFallbackPassword = hasPasswordResult.data;
  const authMode = authModeResult.data;

  return NextResponse.json({
    success: true,
    data: {
      userId: state.userId,
      authUserId: auth.identity.authUserId,
      authSource: state.authSource,
      authMode,
      localLoginEnabled: state.localLoginEnabled,
      localLoginUpdatedAt: state.localLoginUpdatedAt,
      hasFallbackPassword,
      fallbackPasswordSetAt: state.fallbackPasswordSetAt,
      fallbackPasswordUpdatedBy: state.fallbackPasswordUpdatedBy,
      localLoginAllowedNow:
        authMode === 'degraded' &&
        state.localLoginEnabled &&
        hasFallbackPassword,
    },
  });
}
