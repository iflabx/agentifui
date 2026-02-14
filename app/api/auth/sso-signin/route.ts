import { NextResponse } from 'next/server';

/**
 * Deprecated endpoint.
 * SSO sign-in is now handled by better-auth /api/auth/better/sign-in/sso.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Deprecated endpoint',
      message: 'Use /api/auth/better/sign-in/sso for SSO authentication flow.',
    },
    { status: 410 }
  );
}
