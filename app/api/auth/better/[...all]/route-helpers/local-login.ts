import {
  evaluateLocalLoginByEmail,
  extractClientIp,
  parseSignInEmailFromRequest,
  recordLocalLoginAudit,
} from '@lib/auth/better-auth/local-login-policy';

import { syncPostAuthIdentityIfNeeded } from './identity-sync';
import type { BetterAuthRouteHandler } from './types';

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

export async function handleBetterAuthPost(
  request: Request,
  handler: BetterAuthRouteHandler
): Promise<Response> {
  if (!isEmailSignInRequest(request)) {
    const response = await handler.POST(request);
    await syncPostAuthIdentityIfNeeded(request, response);
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
  await syncPostAuthIdentityIfNeeded(request, response);

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
