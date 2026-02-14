import { NextRequest, NextResponse } from 'next/server';

/**
 * Legacy CAS callback endpoint.
 * Replaced by better-auth callback path: /api/auth/better/sso/callback/:providerId
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  const { providerId } = await params;

  return NextResponse.redirect(
    new URL(
      `/login?error=auth_flow_replaced&provider=${encodeURIComponent(providerId)}`,
      request.url
    )
  );
}
