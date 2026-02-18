import {
  getUserLocalLoginStateByUserId,
  setUserLocalLoginEnabledByUserId,
} from '@lib/auth/better-auth/local-login-policy';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';
import { requireAdmin } from '@lib/services/admin/require-admin';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const authResult = await requireAdmin(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { userId } = await params;
  const result = await getUserLocalLoginStateByUserId(userId, {
    actorUserId: authResult.userId,
  });
  if (!result.success) {
    console.error(
      '[AdminAuthFallbackPolicyUser] failed to read user fallback state:',
      result.error
    );
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'auth',
      code: 'LOCAL_LOGIN_USER_STATE_READ_FAILED',
      userMessage: 'Failed to read user fallback state',
      developerMessage:
        result.error?.message || 'Unknown user fallback state read error',
    });
  }

  if (!result.data) {
    return nextApiErrorResponse({
      request,
      status: 404,
      source: 'auth',
      code: 'USER_NOT_FOUND',
      userMessage: 'User not found',
    });
  }

  return NextResponse.json({
    success: true,
    data: result.data,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const authResult = await requireAdmin(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { userId } = await params;

  let payload: { localLoginEnabled?: unknown } = {};
  try {
    payload = (await request.json()) as { localLoginEnabled?: unknown };
  } catch {
    return nextApiErrorResponse({
      request,
      status: 400,
      code: 'REQUEST_JSON_INVALID',
      userMessage: 'Invalid JSON body',
    });
  }

  if (typeof payload.localLoginEnabled !== 'boolean') {
    return nextApiErrorResponse({
      request,
      status: 400,
      source: 'auth',
      code: 'LOCAL_LOGIN_ENABLED_INVALID',
      userMessage: 'localLoginEnabled must be a boolean',
    });
  }

  const updateResult = await setUserLocalLoginEnabledByUserId(
    userId,
    payload.localLoginEnabled,
    {
      actorUserId: authResult.userId,
    }
  );
  if (!updateResult.success) {
    console.error(
      '[AdminAuthFallbackPolicyUser] failed to update user fallback state:',
      updateResult.error
    );
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'auth',
      code: 'LOCAL_LOGIN_USER_STATE_UPDATE_FAILED',
      userMessage: 'Failed to update user fallback state',
      developerMessage:
        updateResult.error?.message ||
        'Unknown user fallback state update error',
    });
  }

  if (!updateResult.data) {
    return nextApiErrorResponse({
      request,
      status: 404,
      source: 'auth',
      code: 'USER_NOT_FOUND',
      userMessage: 'User not found',
    });
  }

  return NextResponse.json({
    success: true,
    data: updateResult.data,
  });
}
