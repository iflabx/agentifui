import { auth } from '@lib/auth/better-auth/server';

import { NextRequest, NextResponse } from 'next/server';

async function withSignOutHeaders(
  request: NextRequest,
  response: NextResponse
): Promise<NextResponse> {
  try {
    const signOutResponse = await auth.api.signOut({
      headers: request.headers,
      asResponse: true,
    });

    const headersWithGetSetCookie = signOutResponse.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const setCookies = headersWithGetSetCookie.getSetCookie?.() || [];

    if (setCookies.length > 0) {
      for (const cookie of setCookies) {
        response.headers.append('set-cookie', cookie);
      }
    } else {
      const cookie = signOutResponse.headers.get('set-cookie');
      if (cookie) {
        response.headers.append('set-cookie', cookie);
      }
    }
  } catch (error) {
    console.error('[LegacySSOLogout] better-auth sign-out failed:', error);
  }

  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  const { providerId } = await params;
  const returnUrl = request.nextUrl.searchParams.get('returnUrl') || '/login';
  const safeReturnUrl = returnUrl.startsWith('/') ? returnUrl : '/login';
  const redirect = NextResponse.redirect(new URL(safeReturnUrl, request.url));
  redirect.headers.set('x-legacy-provider', providerId);
  return withSignOutHeaders(request, redirect);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  const { providerId } = await params;
  const response = NextResponse.json({
    success: true,
    providerId,
    message:
      'Signed out with better-auth. Legacy CAS logout flow is no longer used.',
  });
  return withSignOutHeaders(request, response);
}
