import {
  createCorsHeaders,
  handleCorsPreflightRequest,
} from '@lib/config/cors-config';
import {
  AUTH_SYSTEM_ERRORS,
  getAccountStatusError,
} from '@lib/constants/auth-errors';
import { REQUEST_ID_HEADER, resolveRequestId } from '@lib/errors/app-error';
import {
  getProfileStatusFromApi,
  getSessionFromAuthApi,
  signOutAndRedirect,
} from '@lib/middleware/auth-api';
import {
  isAuthPage,
  isPublicRoute,
  shouldSkipMiddlewareAuthProxy,
} from '@lib/middleware/routes';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function resolvePublicOrigin(request: NextRequest): string {
  const configuredOrigin =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configuredOrigin) {
    try {
      return new URL(configuredOrigin).origin;
    } catch {
      // Fall through to forwarded headers / request origin.
    }
  }

  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');

  if (forwardedHost) {
    return `${forwardedProto || 'http'}://${forwardedHost}`;
  }

  return request.nextUrl.origin;
}

function createPublicUrl(path: string, request: NextRequest): URL {
  return new URL(path, resolvePublicOrigin(request));
}

export async function middleware(request: NextRequest) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const requestId = resolveRequestId(request);

  if (request.method === 'OPTIONS') {
    console.log(`[Middleware] CORS preflight request: ${pathname}`);
    const preflightResponse = handleCorsPreflightRequest(request);
    preflightResponse.headers.set(REQUEST_ID_HEADER, requestId);
    return preflightResponse;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);

  if (pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');
    const corsHeaders = createCorsHeaders(origin);
    corsHeaders.forEach((value, key) => {
      response.headers.set(key, value);
    });

    console.log(
      `[Middleware] Add CORS headers to API route: ${pathname}${origin ? ` (Origin: ${origin})` : ' (No Origin header)'}`
    );
  }

  if (shouldSkipMiddlewareAuthProxy(pathname)) {
    return response;
  }

  const session = await getSessionFromAuthApi(request);
  const user = session?.user ?? null;

  const isAuthRoute = pathname.startsWith('/auth');
  const isApiRoute = pathname.startsWith('/api');
  const isAdminRoute = pathname.startsWith('/admin');
  const authPage = isAuthPage(pathname);
  const publicRoute = isPublicRoute(pathname);

  if (!user && !isAuthRoute && !isApiRoute && !publicRoute) {
    console.log(
      `[Middleware] User not authenticated, redirecting protected route ${pathname} to /login`
    );
    return NextResponse.redirect(createPublicUrl('/login', request));
  }

  if (user) {
    try {
      const profile = await getProfileStatusFromApi(request);

      if (!profile) {
        console.error(
          `[SECURITY] No profile found for authenticated user ${user.id}`
        );
        return await signOutAndRedirect(
          request,
          createPublicUrl(
            `/login?error=${AUTH_SYSTEM_ERRORS.PROFILE_NOT_FOUND}`,
            request
          )
        );
      }

      if (profile.status !== 'active') {
        const errorCode = getAccountStatusError(profile.status);

        console.log(
          `[Middleware] User with status '${profile.status}' attempting to access ${pathname}, signing out and redirecting to login`
        );
        return await signOutAndRedirect(
          request,
          createPublicUrl(`/login?error=${errorCode}`, request)
        );
      }

      if (isAdminRoute && profile.role !== 'admin') {
        console.log(
          `[Middleware] Non-admin user attempting to access admin route ${pathname}, redirecting to /`
        );
        return NextResponse.redirect(createPublicUrl('/', request));
      }

      if (isAdminRoute) {
        console.log(`[Middleware] Admin user accessing ${pathname}`);
      }
    } catch (error) {
      console.error(
        `[SECURITY] Unexpected error in account validation for user ${user.id}:`,
        error instanceof Error ? error.message : 'Unknown error',
        { pathname }
      );
      return await signOutAndRedirect(
        request,
        createPublicUrl(
          `/login?error=${AUTH_SYSTEM_ERRORS.PERMISSION_CHECK_FAILED}`,
          request
        )
      );
    }
  }

  if (user && (pathname === '/' || pathname === '/chat' || authPage)) {
    console.log(
      `[Middleware] User logged in, redirecting ${pathname} to /chat/new`
    );
    return NextResponse.redirect(createPublicUrl('/chat/new', request));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
    '/chat',
    '/chat/:path*',
    '/admin/:path*',
  ],
};
