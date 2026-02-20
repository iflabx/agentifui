import {
  hasCredentialPasswordByAuthUserId,
  markFallbackPasswordUpdated,
} from '@lib/auth/better-auth/local-login-policy';
import { auth } from '@lib/auth/better-auth/server';
import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';

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
    return nextApiErrorResponse({
      request,
      status: 400,
      code: 'REQUEST_JSON_INVALID',
      userMessage: 'Invalid JSON body',
    });
  }

  const currentPassword = parseNonEmptyString(payload.currentPassword);
  const newPassword = parseNonEmptyString(payload.newPassword);

  if (!currentPassword || !newPassword) {
    return nextApiErrorResponse({
      request,
      status: 400,
      code: 'LOCAL_PASSWORD_CHANGE_FIELDS_MISSING',
      userMessage: 'currentPassword and newPassword are required',
    });
  }

  const hasPassword = await hasCredentialPasswordByAuthUserId(
    authResult.identity.authUserId,
    {
      actorUserId: authResult.identity.userId,
    }
  );
  if (!hasPassword.success) {
    console.error(
      '[InternalAuthLocalPasswordChange] failed to detect credential password:',
      hasPassword.error
    );
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'auth',
      code: 'LOCAL_PASSWORD_STATE_DETECT_FAILED',
      userMessage: 'Failed to detect fallback password state',
      developerMessage:
        hasPassword.error?.message ||
        'Unknown fallback password state detection error',
    });
  }

  if (!hasPassword.data) {
    return nextApiErrorResponse({
      request,
      status: 409,
      source: 'auth',
      code: 'LOCAL_PASSWORD_NOT_SET',
      userMessage: 'Fallback password is not set',
    });
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
    return nextApiErrorResponse({
      request,
      status: parsed.status,
      source: 'auth',
      code: 'LOCAL_PASSWORD_CHANGE_FAILED',
      userMessage: parsed.message,
      developerMessage: parsed.message,
    });
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
      '[InternalAuthLocalPasswordChange] failed to write fallback password metadata:',
      markResult.error
    );
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'auth',
      code: 'LOCAL_PASSWORD_METADATA_UPDATE_FAILED',
      userMessage: 'Fallback password changed but metadata update failed',
      developerMessage:
        markResult.error?.message ||
        'Unknown fallback password metadata update error',
    });
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
