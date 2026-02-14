import {
  type AuthMode,
  getAuthModeSetting,
  setAuthModeSetting,
} from '@lib/auth/better-auth/local-login-policy';
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

  const modeResult = await getAuthModeSetting();
  if (!modeResult.success) {
    console.error(
      '[AdminAuthFallbackPolicy] failed to read auth mode:',
      modeResult.error
    );
    return NextResponse.json(
      { error: 'Failed to read auth mode' },
      { status: 500 }
    );
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
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const authMode = parseAuthMode(payload.authMode);
  if (!authMode) {
    return NextResponse.json(
      { error: 'authMode must be "normal" or "degraded"' },
      { status: 400 }
    );
  }

  const updateResult = await setAuthModeSetting(authMode);
  if (!updateResult.success) {
    console.error(
      '[AdminAuthFallbackPolicy] failed to update auth mode:',
      updateResult.error
    );
    return NextResponse.json(
      { error: 'Failed to update auth mode' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    authMode: updateResult.data,
  });
}
