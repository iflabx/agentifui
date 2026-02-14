import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';

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
  const resolvedIdentity = await resolveSessionIdentity(requestHeaders);
  if (!resolvedIdentity.success) {
    console.error(
      '[AdminAuth] Failed to resolve session identity:',
      resolvedIdentity.error
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Failed to verify permissions' },
        { status: 500 }
      ),
    };
  }

  if (!resolvedIdentity.data) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized access' },
        { status: 401 }
      ),
    };
  }

  if (resolvedIdentity.data.role !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    userId: resolvedIdentity.data.userId,
  };
}
