import {
  evaluateLocalLoginByEmail,
  extractClientIp,
  parseSignInEmailFromRequest,
  recordLocalLoginAudit,
} from '@lib/auth/better-auth/local-login-policy';
import { auth } from '@lib/auth/better-auth/server';
import { syncSessionIdentitySideEffects } from '@lib/auth/better-auth/session-identity';
import '@lib/server/realtime/runtime-registry';
import { toNextJsHandler } from 'better-auth/next-js';

const handler = toNextJsHandler(auth);
type HeadersWithGetSetCookie = Headers & {
  getSetCookie?: () => string[];
};

function isEmailSignInRequest(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return pathname.endsWith('/sign-in/email');
}

async function parseLocalSignInEmail(request: Request): Promise<string | null> {
  const contentType = request.headers.get('content-type') || '';
  const clone = request.clone();

  try {
    if (contentType.includes('application/json')) {
      return parseSignInEmailFromRequest(await clone.json());
    }

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const body = await clone.text();
      const params = new URLSearchParams(body);
      return params.get('email')?.trim().toLowerCase() || null;
    }
  } catch {
    return null;
  }

  return null;
}

function localLoginBlockedResponse(reason: string): Response {
  if (reason === 'blocked_auth_mode') {
    return Response.json(
      {
        code: 'LOCAL_LOGIN_DISABLED',
        message:
          'Local login is available only when auth_mode is degraded and fallback is enabled.',
      },
      { status: 403 }
    );
  }

  if (reason === 'blocked_user_toggle') {
    return Response.json(
      {
        code: 'LOCAL_LOGIN_DISABLED',
        message: 'Local fallback login is not enabled for this account.',
      },
      { status: 403 }
    );
  }

  if (reason === 'missing_fallback_password') {
    return Response.json(
      {
        code: 'FALLBACK_PASSWORD_NOT_SET',
        message:
          'Local fallback password is not set. Please configure fallback password first.',
      },
      { status: 403 }
    );
  }

  return Response.json(
    {
      code: 'LOCAL_LOGIN_DISABLED',
      message: 'Local login is currently unavailable for this account.',
    },
    { status: 403 }
  );
}

function readSetCookies(headers: Headers): string[] {
  const headersWithGetSetCookie = headers as HeadersWithGetSetCookie;
  const getSetCookie = headersWithGetSetCookie.getSetCookie;
  if (typeof getSetCookie === 'function') {
    const cookies = getSetCookie.call(headersWithGetSetCookie);
    if (Array.isArray(cookies) && cookies.length > 0) {
      return cookies;
    }
  }

  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function parseCookiePair(rawCookie: string): {
  name: string;
  value: string;
} | null {
  const firstSegment = rawCookie.split(';', 1)[0]?.trim();
  if (!firstSegment) {
    return null;
  }

  const equalsIndex = firstSegment.indexOf('=');
  if (equalsIndex <= 0) {
    return null;
  }

  const name = firstSegment.slice(0, equalsIndex).trim();
  const value = firstSegment.slice(equalsIndex + 1).trim();
  if (!name) {
    return null;
  }

  return { name, value };
}

function mergeCookieHeader(
  existingCookieHeader: string | null,
  setCookies: string[]
): string | null {
  const cookieMap = new Map<string, string>();

  const addCookiePair = (cookiePair: string) => {
    const equalsIndex = cookiePair.indexOf('=');
    if (equalsIndex <= 0) {
      return;
    }
    const name = cookiePair.slice(0, equalsIndex).trim();
    const value = cookiePair.slice(equalsIndex + 1).trim();
    if (!name) {
      return;
    }
    cookieMap.set(name, value);
  };

  if (existingCookieHeader) {
    for (const token of existingCookieHeader.split(';')) {
      const trimmed = token.trim();
      if (!trimmed) {
        continue;
      }
      addCookiePair(trimmed);
    }
  }

  for (const rawSetCookie of setCookies) {
    const parsed = parseCookiePair(rawSetCookie);
    if (!parsed) {
      continue;
    }
    cookieMap.set(parsed.name, parsed.value);
  }

  if (cookieMap.size === 0) {
    return existingCookieHeader;
  }

  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function shouldTriggerAuthIdentitySync(
  request: Request,
  response: Response,
  setCookies: string[]
): boolean {
  if (setCookies.length === 0) {
    return false;
  }
  if (response.status < 200 || response.status >= 400) {
    return false;
  }

  const { pathname } = new URL(request.url);
  return (
    pathname.includes('/sign-in/') ||
    pathname.includes('/sign-up/') ||
    pathname.includes('/callback/')
  );
}

function triggerPostAuthIdentitySync(
  request: Request,
  response: Response
): void {
  const setCookies = readSetCookies(response.headers);
  if (!shouldTriggerAuthIdentitySync(request, response, setCookies)) {
    return;
  }

  const mergedCookieHeader = mergeCookieHeader(
    request.headers.get('cookie'),
    setCookies
  );
  const syncHeaders = new Headers(request.headers);
  if (mergedCookieHeader) {
    syncHeaders.set('cookie', mergedCookieHeader);
  }

  void syncSessionIdentitySideEffects(syncHeaders)
    .then(result => {
      if (!result.success) {
        console.warn(
          '[AuthIdentitySync] post-login identity sync failed:',
          result.error
        );
      }
    })
    .catch(error => {
      console.warn(
        '[AuthIdentitySync] unexpected post-login identity sync error:',
        error
      );
    });
}

export async function GET(request: Request) {
  const response = await handler.GET(request);
  triggerPostAuthIdentitySync(request, response);
  return response;
}

export async function POST(request: Request) {
  if (!isEmailSignInRequest(request)) {
    const response = await handler.POST(request);
    triggerPostAuthIdentitySync(request, response);
    return response;
  }

  const email = await parseLocalSignInEmail(request);
  const ipAddress = extractClientIp(request);
  const userAgent = request.headers.get('user-agent') || null;

  const decision = await evaluateLocalLoginByEmail(email);
  if (!decision.success) {
    console.error(
      '[AuthLocalLoginPolicy] failed to evaluate local login policy:',
      decision.error
    );
    return Response.json(
      {
        code: 'LOCAL_LOGIN_POLICY_ERROR',
        message: 'Failed to evaluate local login policy',
      },
      { status: 503 }
    );
  }

  const { data } = decision;
  if (!data.allowed) {
    await recordLocalLoginAudit({
      email: data.email,
      userId: data.userId,
      authMode: data.authMode,
      outcome: 'blocked',
      reason: data.reason,
      statusCode: 403,
      ipAddress,
      userAgent,
    });

    return localLoginBlockedResponse(data.reason);
  }

  const response = await handler.POST(request);
  triggerPostAuthIdentitySync(request, response);

  await recordLocalLoginAudit({
    email: data.email,
    userId: data.userId,
    authMode: data.authMode,
    outcome: response.ok ? 'success' : 'failed',
    reason: response.ok ? data.reason : 'credentials_rejected',
    statusCode: response.status,
    ipAddress,
    userAgent,
  });

  return response;
}

export async function PATCH(request: Request) {
  return handler.PATCH(request);
}

export async function PUT(request: Request) {
  return handler.PUT(request);
}

export async function DELETE(request: Request) {
  return handler.DELETE(request);
}
