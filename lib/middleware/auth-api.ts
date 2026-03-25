import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  BETTER_AUTH_BASE_PATH,
  type BetterAuthSessionPayload,
  INTERNAL_PROFILE_STATUS_PATH,
  type ProfileStatusPayload,
} from './constants';
import {
  createAuthProxyHeaders,
  extractSetCookies,
  fetchInternalEndpoint,
} from './request-utils';

export async function signOutAndRedirect(
  request: NextRequest,
  url: URL
): Promise<NextResponse> {
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

export async function getSessionFromAuthApi(
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

export async function getProfileStatusFromApi(
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
