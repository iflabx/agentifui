import {
  getUserLocalLoginStateByUserId,
  setUserLocalLoginEnabledByUserId,
} from '@lib/auth/better-auth/local-login-policy';
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
    return NextResponse.json(
      { error: 'Failed to read user fallback state' },
      { status: 500 }
    );
  }

  if (!result.data) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
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
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof payload.localLoginEnabled !== 'boolean') {
    return NextResponse.json(
      { error: 'localLoginEnabled must be a boolean' },
      { status: 400 }
    );
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
    return NextResponse.json(
      { error: 'Failed to update user fallback state' },
      { status: 500 }
    );
  }

  if (!updateResult.data) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: updateResult.data,
  });
}
