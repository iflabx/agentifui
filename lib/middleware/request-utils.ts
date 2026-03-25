import type { NextRequest } from 'next/server';

import {
  BETTER_AUTH_BASE_PATH,
  INTERNAL_AUTH_PROXY_HEADER,
  INTERNAL_FETCH_TIMEOUT_MS_FALLBACK,
} from './constants';

export function parsePositiveInteger(
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

export function resolveInternalOrigins(request: NextRequest): string[] {
  const origins: string[] = [];
  const pushUnique = (candidate: string | null) => {
    if (candidate && !origins.includes(candidate)) {
      origins.push(candidate);
    }
  };

  pushUnique(request.nextUrl.origin);
  pushUnique(swapLoopbackOrigin(request.nextUrl.origin));
  pushUnique(normalizeOrigin(process.env.BETTER_AUTH_URL));
  pushUnique(normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL));
  pushUnique(normalizeOrigin(process.env.AUTH_BASE_URL));

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

export async function fetchInternalEndpoint(
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

export function createAuthProxyHeaders(request: NextRequest): HeadersInit {
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

  headers.set(INTERNAL_AUTH_PROXY_HEADER, '1');

  return headers;
}

export function extractSetCookies(headers: Headers): string[] {
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
