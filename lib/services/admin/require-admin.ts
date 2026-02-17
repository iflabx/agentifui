import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import {
  REQUEST_ID_HEADER,
  buildAppErrorDetail,
  buildAppErrorEnvelope,
  resolveRequestId,
} from '@lib/errors/app-error';
import { recordErrorEvent } from '@lib/server/errors/error-events';
import { getRequestErrorContext } from '@lib/server/errors/request-context';

import { NextResponse } from 'next/server';

export type RequireAdminResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: NextResponse;
    };

/**
 * Enforce admin access for admin API routes.
 * Returns a typed guard result so handlers can short-circuit consistently.
 */
export async function requireAdmin(
  requestHeaders: Headers
): Promise<RequireAdminResult> {
  const requestContext = getRequestErrorContext();
  const requestId =
    requestContext?.requestId || resolveRequestId(requestHeaders);
  const route = requestContext?.route;
  const method = requestContext?.method;

  const toAdminErrorResponse = (
    message: string,
    status: number,
    code?: string
  ): NextResponse => {
    const detail = buildAppErrorDetail({
      status,
      code,
      source: 'auth',
      requestId,
      userMessage: message,
      developerMessage: message,
    });
    const response = NextResponse.json(buildAppErrorEnvelope(detail, message), {
      status,
    });
    response.headers.set(REQUEST_ID_HEADER, requestId);

    void recordErrorEvent({
      code: detail.code,
      source: detail.source,
      severity: detail.severity,
      retryable: detail.retryable,
      userMessage: detail.userMessage,
      developerMessage: detail.developerMessage,
      requestId,
      httpStatus: status,
      method,
      route,
      actorUserId: requestContext?.actorUserId,
    }).catch(error => {
      console.warn(
        '[AdminAuth] failed to record admin auth error:',
        error instanceof Error ? error.message : String(error)
      );
    });

    return response;
  };

  const resolvedIdentity = await resolveSessionIdentity(requestHeaders);
  if (!resolvedIdentity.success) {
    console.error(
      '[AdminAuth] Failed to resolve session identity:',
      resolvedIdentity.error
    );
    return {
      ok: false,
      response: toAdminErrorResponse(
        'Failed to verify permissions',
        500,
        'AUTH_VERIFY_FAILED'
      ),
    };
  }

  if (!resolvedIdentity.data) {
    return {
      ok: false,
      response: toAdminErrorResponse(
        'Unauthorized access',
        401,
        'AUTH_UNAUTHORIZED'
      ),
    };
  }

  if (resolvedIdentity.data.role !== 'admin') {
    return {
      ok: false,
      response: toAdminErrorResponse(
        'Insufficient permissions',
        403,
        'AUTH_FORBIDDEN'
      ),
    };
  }

  return {
    ok: true,
    userId: resolvedIdentity.data.userId,
  };
}
