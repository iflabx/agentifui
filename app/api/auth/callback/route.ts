import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Legacy callback endpoint kept only for backward URL compatibility.
 * New OAuth/OIDC flow is handled by better-auth native callbacks under /api/auth/better/*.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const redirectTo = requestUrl.searchParams.get('redirectTo') || '/login';
  const safeRedirect = redirectTo.startsWith('/') ? redirectTo : '/login';

  return NextResponse.redirect(
    new URL(`${safeRedirect}?error=auth_flow_replaced`, request.url)
  );
}
