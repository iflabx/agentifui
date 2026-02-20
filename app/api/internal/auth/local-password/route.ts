import {
  getAuthModeSetting,
  getUserLocalLoginStateByUserId,
  hasCredentialPasswordByAuthUserId,
} from '@lib/auth/better-auth/local-login-policy';
import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';

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
      response: nextApiErrorResponse({
        request,
        status: 500,
        source: 'auth',
        code: 'AUTH_VERIFY_FAILED',
        userMessage: 'Failed to verify session',
        developerMessage:
          identity.error?.message ||
          'resolveSessionIdentity returned unsuccessful result',
      }),
    };
  }

  if (!identity.data) {
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
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'auth',
      code: 'AUTH_MODE_READ_FAILED',
      userMessage: 'Failed to read auth mode',
      developerMessage:
        authModeResult.error?.message || 'Unknown auth mode read error',
    });
  }

  if (!localStateResult.success) {
    console.error(
      '[InternalAuthLocalPassword] failed to read local password state:',
      localStateResult.error
    );
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'auth',
      code: 'LOCAL_PASSWORD_STATE_READ_FAILED',
      userMessage: 'Failed to read local password state',
      developerMessage:
        localStateResult.error?.message ||
        'Unknown local password state read error',
    });
  }

  if (!localStateResult.data) {
    return nextApiErrorResponse({
      request,
      status: 404,
      code: 'PROFILE_NOT_FOUND',
      userMessage: 'Profile not found',
    });
  }

  if (!hasPasswordResult.success) {
    console.error(
      '[InternalAuthLocalPassword] failed to detect fallback password:',
      hasPasswordResult.error
    );
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'auth',
      code: 'LOCAL_PASSWORD_STATE_DETECT_FAILED',
      userMessage: 'Failed to detect fallback password state',
      developerMessage:
        hasPasswordResult.error?.message ||
        'Unknown fallback password state detection error',
    });
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
