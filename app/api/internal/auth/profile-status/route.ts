import { auth } from '@lib/auth/better-auth/server';
import { getPgPool } from '@lib/server/pg/pool';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type ProfileRow = {
  role: string | null;
  status: string | null;
};

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const pool = getPgPool();
    const result = await pool.query<ProfileRow>(
      'SELECT role, status FROM profiles WHERE id = $1 LIMIT 1',
      [userId]
    );
    const profile = result.rows[0] ?? null;

    if (!profile) {
      return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        role: profile.role,
        status: profile.status,
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
