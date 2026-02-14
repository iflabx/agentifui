import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const resolvedIdentity = await resolveSessionIdentity(request.headers);
    if (!resolvedIdentity.success) {
      console.error(
        '[InternalAuthProfileStatus] failed to resolve session identity:',
        resolvedIdentity.error
      );
      return NextResponse.json(
        {
          error: 'profile_status_failed',
        },
        { status: 500 }
      );
    }

    if (!resolvedIdentity.data) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    return NextResponse.json(
      {
        role: resolvedIdentity.data.role,
        status: resolvedIdentity.data.status,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error(
      '[InternalAuthProfileStatus] failed to resolve profile status:',
      error
    );
    return NextResponse.json(
      {
        error: 'profile_status_failed',
      },
      { status: 500 }
    );
  }
}
