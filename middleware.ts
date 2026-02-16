import {
  createCorsHeaders,
  handleCorsPreflightRequest,
} from '@lib/config/cors-config';
import {
  AUTH_SYSTEM_ERRORS,
  getAccountStatusError,
} from '@lib/constants/auth-errors';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BETTER_AUTH_BASE_PATH = '/api/auth/better';
const INTERNAL_PROFILE_STATUS_PATH = '/api/internal/auth/profile-status';
const INTERNAL_STORAGE_BASE_PATH = '/api/internal/storage';
const INTERNAL_REALTIME_BASE_PATH = '/api/internal/realtime';
const INTERNAL_AUTH_PROXY_HEADER = 'x-agentifui-internal-auth-proxy';
const INTERNAL_FETCH_TIMEOUT_MS_FALLBACK = 3000;

type BetterAuthSessionPayload = {
  user?: {
    id?: string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

type ProfileStatusPayload = {
  role: string | null;
  status: string | null;
};

function parsePositiveInteger(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeOrigin(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).origin;
  } catch {
    return null;
  }
}

function swapLoopbackOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin);
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
      return parsed.origin;
    }
    if (parsed.hostname === '127.0.0.1') {
      parsed.hostname = 'localhost';
      return parsed.origin;
    }
  } catch {
    return null;
  }
  return null;
}

function resolveInternalOrigins(request: NextRequest): string[] {
  const origins: string[] = [];
  const pushUnique = (candidate: string | null) => {
    if (candidate && !origins.includes(candidate)) {
      origins.push(candidate);
    }
  };

  pushUnique(normalizeOrigin(process.env.BETTER_AUTH_URL));
  pushUnique(normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL));
  pushUnique(normalizeOrigin(process.env.AUTH_BASE_URL));
  pushUnique(request.nextUrl.origin);
  pushUnique(swapLoopbackOrigin(request.nextUrl.origin));

  return origins;
}

function createAbortControllerWithTimeout(timeoutMs: number): {
  controller: AbortController;
  clear: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    clear: () => clearTimeout(timeoutId),
  };
}

async function fetchInternalEndpoint(
  request: NextRequest,
  path: string,
  init: RequestInit
): Promise<Response> {
  const origins = resolveInternalOrigins(request);
  const timeoutMs = parsePositiveInteger(
    process.env.MIDDLEWARE_INTERNAL_FETCH_TIMEOUT_MS,
    INTERNAL_FETCH_TIMEOUT_MS_FALLBACK
  );

  let lastError: unknown = null;
  for (const origin of origins) {
    const url = `${origin}${path}`;
    const { controller, clear } = createAbortControllerWithTimeout(timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      lastError = error;
    } finally {
      clear();
    }
  }

  throw (
    lastError ||
    new Error(`[Middleware] Failed internal fetch for path ${path}`)
  );
}

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

  // Auth API endpoints must remain free from profile/status checks to avoid auth loop.
  if (
    pathname.startsWith(BETTER_AUTH_BASE_PATH) ||
    pathname.startsWith(INTERNAL_PROFILE_STATUS_PATH) ||
    pathname.startsWith('/api/auth/sso/providers') ||
    pathname.startsWith(INTERNAL_STORAGE_BASE_PATH) ||
    pathname.startsWith(INTERNAL_REALTIME_BASE_PATH)
  ) {
    return response;
  }

  // Get current session via better-auth HTTP API to keep middleware edge-safe.
  const session = await getSessionFromAuthApi(request);
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
  // Query profile once to get both status and role for performance optimization.
  if (user) {
    try {
      const profile = await getProfileStatusFromApi(request);

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
    const signOutResponse = await fetchInternalEndpoint(
      request,
      `${BETTER_AUTH_BASE_PATH}/sign-out`,
      {
        method: 'POST',
        headers: createAuthProxyHeaders(request),
      }
    );

    const setCookies = extractSetCookies(signOutResponse.headers);
    for (const cookie of setCookies) {
      redirectResponse.headers.append('set-cookie', cookie);
    }
  } catch (error) {
    console.warn(
      '[Middleware] Failed to sign out session during redirect:',
      error
    );
  }

  return redirectResponse;
}

async function getSessionFromAuthApi(
  request: NextRequest
): Promise<BetterAuthSessionPayload | null> {
  try {
    const sessionResponse = await fetchInternalEndpoint(
      request,
      `${BETTER_AUTH_BASE_PATH}/get-session`,
      {
        method: 'GET',
        headers: createAuthProxyHeaders(request),
      }
    );

    if (sessionResponse.status === 401) {
      return null;
    }

    if (!sessionResponse.ok) {
      console.warn(
        `[Middleware] Auth session API failed (${sessionResponse.status})`
      );
      return null;
    }

    const payload = (await sessionResponse
      .json()
      .catch(() => null)) as BetterAuthSessionPayload | null;
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    return payload;
  } catch (authError) {
    console.log(`[Middleware] Auth verification failed: ${authError}`);
    return null;
  }
}

function createAuthProxyHeaders(request: NextRequest): HeadersInit {
  const cookie = request.headers.get('cookie') || '';
  const userAgent = request.headers.get('user-agent') || '';
  const forwardedFor = request.headers.get('x-forwarded-for') || '';
  const forwardedProto = request.headers.get('x-forwarded-proto') || '';
  const forwardedHost = request.headers.get('x-forwarded-host') || '';
  const headers = new Headers();

  if (cookie) {
    headers.set('cookie', cookie);
  }
  if (userAgent) {
    headers.set('user-agent', userAgent);
  }
  if (forwardedFor) {
    headers.set('x-forwarded-for', forwardedFor);
  }
  if (forwardedProto) {
    headers.set('x-forwarded-proto', forwardedProto);
  } else if (request.nextUrl.protocol) {
    headers.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''));
  }
  if (forwardedHost) {
    headers.set('x-forwarded-host', forwardedHost);
  } else if (request.nextUrl.host) {
    headers.set('x-forwarded-host', request.nextUrl.host);
  }

  // Tell better-auth this is an internal middleware proxy request.
  headers.set(INTERNAL_AUTH_PROXY_HEADER, '1');

  return headers;
}

function extractSetCookies(headers: Headers): string[] {
  const headersWithGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headersWithGetSetCookie.getSetCookie?.() || [];
  if (setCookies.length > 0) {
    return setCookies;
  }

  const singleSetCookie = headers.get('set-cookie');
  return singleSetCookie ? [singleSetCookie] : [];
}

async function getProfileStatusFromApi(
  request: NextRequest
): Promise<ProfileStatusPayload | null> {
  const profileResponse = await fetchInternalEndpoint(
    request,
    INTERNAL_PROFILE_STATUS_PATH,
    {
      method: 'GET',
      headers: createAuthProxyHeaders(request),
    }
  );

  if (profileResponse.status === 401) {
    return null;
  }

  if (!profileResponse.ok) {
    throw new Error(
      `[Middleware] Profile status API failed (${profileResponse.status})`
    );
  }

  const payload = (await profileResponse
    .json()
    .catch(() => null)) as Partial<ProfileStatusPayload> | null;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return {
    role: typeof payload.role === 'string' ? payload.role : null,
    status: typeof payload.status === 'string' ? payload.status : null,
  };
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
