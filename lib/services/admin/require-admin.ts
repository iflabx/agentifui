import { auth } from '@lib/auth/better-auth/server';
import { getPgPool } from '@lib/server/pg/pool';

import { NextResponse } from 'next/server';

export type RequireAdminResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: NextResponse;
    };

/**
 * Enforce admin access for admin API routes.
 * Returns a typed guard result so handlers can short-circuit consistently.
 */
export async function requireAdmin(
  requestHeaders: Headers
): Promise<RequireAdminResult> {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({
      headers: requestHeaders,
    });
  } catch (authError) {
    console.error('[AdminAuth] Failed to get auth session:', authError);
  }

  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized access' },
        { status: 401 }
      ),
    };
  }

  const pool = getPgPool();
  try {
    const result = await pool.query<{ role: string | null }>(
      'SELECT role FROM profiles WHERE id = $1 LIMIT 1',
      [session.user.id]
    );
    const role = result.rows[0]?.role ?? null;
    if (role !== 'admin') {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Insufficient permissions' },
          { status: 403 }
        ),
      };
    }
  } catch (profileError) {
    console.error('[AdminAuth] Failed to verify admin role:', profileError);
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Failed to verify permissions' },
        { status: 500 }
      ),
    };
  }

  return {
    ok: true,
    userId: session.user.id,
  };
}
