import {
  type AuthMode,
  getAuthModeSetting,
  setAuthModeSetting,
} from '@lib/auth/better-auth/local-login-policy';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';
import { requireAdmin } from '@lib/services/admin/require-admin';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function parseAuthMode(input: unknown): AuthMode | null {
  if (typeof input !== 'string') {
    return null;
  }

  const normalized = input.trim().toLowerCase();
  if (normalized === 'normal' || normalized === 'degraded') {
    return normalized;
  }

  return null;
}

export async function GET(request: Request) {
  const authResult = await requireAdmin(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const modeResult = await getAuthModeSetting({
    actorUserId: authResult.userId,
  });
  if (!modeResult.success) {
    console.error(
      '[AdminAuthFallbackPolicy] failed to read auth mode:',
      modeResult.error
    );
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'auth',
      code: 'AUTH_MODE_READ_FAILED',
      userMessage: 'Failed to read auth mode',
      developerMessage:
        modeResult.error?.message || 'Unknown auth mode read error',
    });
  }

  return NextResponse.json({
    success: true,
    authMode: modeResult.data,
  });
}

export async function PATCH(request: Request) {
  const authResult = await requireAdmin(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  let payload: { authMode?: unknown } = {};
  try {
    payload = (await request.json()) as { authMode?: unknown };
  } catch {
    return nextApiErrorResponse({
      request,
      status: 400,
      code: 'REQUEST_JSON_INVALID',
      userMessage: 'Invalid JSON body',
    });
  }

  const authMode = parseAuthMode(payload.authMode);
  if (!authMode) {
    return nextApiErrorResponse({
      request,
      status: 400,
      source: 'auth',
      code: 'AUTH_MODE_INVALID',
      userMessage: 'authMode must be "normal" or "degraded"',
    });
  }

  const updateResult = await setAuthModeSetting(authMode, {
    actorUserId: authResult.userId,
  });
  if (!updateResult.success) {
    console.error(
      '[AdminAuthFallbackPolicy] failed to update auth mode:',
      updateResult.error
    );
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'auth',
      code: 'AUTH_MODE_UPDATE_FAILED',
      userMessage: 'Failed to update auth mode',
      developerMessage:
        updateResult.error?.message || 'Unknown auth mode update error',
    });
  }

  return NextResponse.json({
    success: true,
    authMode: updateResult.data,
  });
}
