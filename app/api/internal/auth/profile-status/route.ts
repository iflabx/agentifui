import {
  isRecoverableReadOnlyIdentityError,
  resolveSessionIdentityReadOnly,
  syncSessionIdentitySideEffects,
} from '@lib/auth/better-auth/session-identity';
import {
  REQUEST_ID_HEADER,
  buildAppErrorDetail,
  buildAppErrorEnvelope,
  resolveRequestId,
} from '@lib/errors/app-error';
import '@lib/server/realtime/runtime-registry';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function buildErrorResponse(
  request: Request,
  input: {
    status: number;
    code: string;
    userMessage: string;
    developerMessage: string;
  }
) {
  const requestId = resolveRequestId(request);
  const detail = buildAppErrorDetail({
    status: input.status,
    source: 'next-api',
    code: input.code,
    userMessage: input.userMessage,
    developerMessage: input.developerMessage,
    requestId,
  });
  const response = NextResponse.json(
    buildAppErrorEnvelope(detail, input.userMessage),
    {
      status: input.status,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export async function GET(request: Request) {
  try {
    let resolvedIdentity = await resolveSessionIdentityReadOnly(
      request.headers
    );

    if (
      !resolvedIdentity.success &&
      isRecoverableReadOnlyIdentityError(resolvedIdentity.error)
    ) {
      console.warn(
        '[InternalAuthProfileStatus] read-only resolve hit recoverable gap, retrying with side effects:',
        resolvedIdentity.error
      );
      resolvedIdentity = await syncSessionIdentitySideEffects(request.headers);
    }

    if (!resolvedIdentity.success) {
      console.error(
        '[InternalAuthProfileStatus] failed to resolve session identity:',
        resolvedIdentity.error
      );
      return buildErrorResponse(request, {
        status: 500,
        code: 'AUTH_PROFILE_STATUS_RESOLVE_FAILED',
        userMessage: 'Failed to resolve profile status',
        developerMessage:
          resolvedIdentity.error?.message ||
          'resolveSessionIdentityReadOnly returned failure',
      });
    }

    if (!resolvedIdentity.data) {
      return buildErrorResponse(request, {
        status: 401,
        code: 'AUTH_UNAUTHORIZED',
        userMessage: 'Unauthorized',
        developerMessage: 'No authenticated session identity',
      });
    }

    return NextResponse.json(
      {
        userId: resolvedIdentity.data.userId,
        authUserId: resolvedIdentity.data.authUserId,
        role: resolvedIdentity.data.role,
        status: resolvedIdentity.data.status,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error(
      '[InternalAuthProfileStatus] failed to resolve profile status:',
      error
    );
    return buildErrorResponse(request, {
      status: 500,
      code: 'AUTH_PROFILE_STATUS_EXCEPTION',
      userMessage: 'Failed to resolve profile status',
      developerMessage:
        error instanceof Error ? error.message : 'Unknown profile status error',
    });
  }
}
