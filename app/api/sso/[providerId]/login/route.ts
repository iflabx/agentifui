import { NextRequest, NextResponse } from 'next/server';

/**
 * Legacy CAS login endpoint.
 * Replaced by better-auth SSO entrypoint: /api/auth/better/sign-in/sso
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  const { providerId } = await params;
  const callbackURL = request.nextUrl.searchParams.get('returnUrl') || '/chat';
  const safeCallbackURL = callbackURL.startsWith('/') ? callbackURL : '/chat';

  return NextResponse.redirect(
    new URL(
      `/login?error=auth_flow_replaced&provider=${encodeURIComponent(providerId)}&callback=${encodeURIComponent(safeCallbackURL)}`,
      request.url
    )
  );
}
