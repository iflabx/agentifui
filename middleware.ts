import { auth } from '@lib/auth/better-auth/server';
import {
  createCorsHeaders,
  handleCorsPreflightRequest,
} from '@lib/config/cors-config';
import {
  AUTH_SYSTEM_ERRORS,
  getAccountStatusError,
} from '@lib/constants/auth-errors';
import { getPgPool } from '@lib/server/pg/pool';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// This middleware intercepts all requests.
// Uses better-auth + PostgreSQL profile checks for route protection.
export async function middleware(request: NextRequest) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 1. Prioritize CORS preflight requests
  if (request.method === 'OPTIONS') {
    console.log(`[Middleware] CORS preflight request: ${pathname}`);
    return handleCorsPreflightRequest(request);
  }

  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // 2. Automatically add CORS headers to all API routes
  // This ensures that all APIs receive uniform CORS protection, without manual addition
  if (pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');
    const corsHeaders = createCorsHeaders(origin);

    // Add CORS headers to the response
    corsHeaders.forEach((value, key) => {
      response.headers.set(key, value);
    });

    console.log(
      `[Middleware] Add CORS headers to API route: ${pathname}${origin ? ` (Origin: ${origin})` : ' (No Origin header)'}`
    );
  }

  // Highest priority: If the user directly accesses /chat, redirect to /chat/new
  // This ensures that always starts from a clear new conversation state.
  if (pathname === '/chat') {
    const newChatUrl = new URL('/chat/new', request.url);
    console.log(
      `[Middleware] Exact /chat match. Redirecting to ${newChatUrl.toString()}`
    );
    return NextResponse.redirect(newChatUrl);
  }

  // Get current session from better-auth.
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({
      headers: request.headers,
    });
  } catch (authError) {
    console.log(`[Middleware] Auth verification failed: ${authError}`);
  }
  const user = session?.user ?? null;

  // Route protection logic based on user session status
  // In sso mode, prohibit registration-related routes
  const isAuthRoute = pathname.startsWith('/auth');
  const isApiRoute = pathname.startsWith('/api');
  const isAdminRoute = pathname.startsWith('/admin');

  // Authentication-related page definitions (pages that should not be accessed by logged-in users)
  const isAuthPage =
    pathname === '/login' ||
    pathname.startsWith('/register') ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password' ||
    pathname === '/phone-login';

  const isPublicRoute =
    pathname === '/' ||
    pathname === '/about' ||
    pathname.startsWith('/sso/processing') ||
    (process.env.NEXT_PUBLIC_SSO_ONLY_MODE !== 'true' && isAuthPage) ||
    (process.env.NEXT_PUBLIC_SSO_ONLY_MODE === 'true' && pathname === '/login');

  // Enable route protection logic, ensuring that users who are not logged in cannot access protected routes
  if (!user && !isAuthRoute && !isApiRoute && !isPublicRoute) {
    console.log(
      `[Middleware] User not authenticated, redirecting protected route ${pathname} to /login`
    );
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // 🔒 Check user account status and admin permissions for authenticated users
  // Query profile once to get both status and role for performance optimization
  if (user) {
    try {
      const pool = getPgPool();
      const profileResult = await pool.query<{
        role: string | null;
        status: string | null;
      }>('SELECT role, status FROM profiles WHERE id = $1 LIMIT 1', [user.id]);
      const profile = profileResult.rows[0] ?? null;

      // 🔒 Defense: Handle missing profile (should never happen but defensive)
      if (!profile) {
        console.error(
          `[SECURITY] No profile found for authenticated user ${user.id}`
        );
        return await signOutAndRedirect(
          request,
          new URL(
            `/login?error=${AUTH_SYSTEM_ERRORS.PROFILE_NOT_FOUND}`,
            request.url
          )
        );
      }

      // Now we have a valid profile, check status and permissions
      {
        // 🔒 Priority 1: Check account status using whitelist validation
        // Only 'active' status users are allowed to access protected routes
        // This prevents bypass via invalid status values (NULL, typos, unexpected enums)
        if (profile.status !== 'active') {
          const errorCode = getAccountStatusError(profile.status);

          console.log(
            `[Middleware] User with status '${profile.status}' attempting to access ${pathname}, signing out and redirecting to login`
          );
          return await signOutAndRedirect(
            request,
            new URL(`/login?error=${errorCode}`, request.url)
          );
        }

        // 🔒 Priority 2: Check admin route permissions
        if (isAdminRoute && profile.role !== 'admin') {
          console.log(
            `[Middleware] Non-admin user attempting to access admin route ${pathname}, redirecting to /`
          );
          return NextResponse.redirect(new URL('/', request.url));
        }

        if (isAdminRoute) {
          console.log(`[Middleware] Admin user accessing ${pathname}`);
        }
      }
    } catch (error) {
      console.error(
        `[SECURITY] Unexpected error in account validation for user ${user.id}:`,
        error instanceof Error ? error.message : 'Unknown error',
        { pathname }
      );
      return await signOutAndRedirect(
        request,
        new URL(
          `/login?error=${AUTH_SYSTEM_ERRORS.PERMISSION_CHECK_FAILED}`,
          request.url
        )
      );
    }
  }

  // When a logged-in user accesses the root directory or authentication page, redirect to the new chat page
  if (user && (pathname === '/' || isAuthPage)) {
    console.log(
      `[Middleware] User logged in, redirecting ${pathname} to /chat/new`
    );
    return NextResponse.redirect(new URL('/chat/new', request.url));
  }

  return response;
}

async function signOutAndRedirect(request: NextRequest, url: URL) {
  const redirectResponse = NextResponse.redirect(url);

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
        redirectResponse.headers.append('set-cookie', cookie);
      }
    } else {
      const singleSetCookie = signOutResponse.headers.get('set-cookie');
      if (singleSetCookie) {
        redirectResponse.headers.append('set-cookie', singleSetCookie);
      }
    }
  } catch (error) {
    console.warn(
      '[Middleware] Failed to sign out session during redirect:',
      error
    );
  }

  return redirectResponse;
}

// Configure the paths matched by the middleware
export const config = {
  matcher: [
    // Exclude static files and server-side APIs
    '/((?!_next/static|_next/image|favicon.ico).*)',
    '/chat', // Ensure /chat is intercepted to redirect
    '/chat/:path*', // Intercept all paths under /chat
    '/admin/:path*', // Intercept all paths under /admin
  ],
};
