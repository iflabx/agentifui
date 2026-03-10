import { resolveSessionIdentityReadOnly } from '@lib/auth/better-auth/session-identity';
import {
  REQUEST_ID_HEADER,
  buildAppErrorDetail,
  buildAppErrorEnvelope,
  resolveRequestId,
} from '@lib/errors/app-error';
import { recordErrorEvent } from '@lib/server/errors/error-events';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type PayloadObject = Record<string, unknown>;

type SupportedSeverity = 'info' | 'warn' | 'error' | 'critical';

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, 4000) : null;
}

function readBoolean(value: unknown, fallbackValue: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  return fallbackValue;
}

function readNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function readObject(value: unknown): PayloadObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as PayloadObject;
}

function readSeverity(value: unknown): SupportedSeverity {
  const normalized = readString(value)?.toLowerCase();
  if (
    normalized === 'info' ||
    normalized === 'warn' ||
    normalized === 'error' ||
    normalized === 'critical'
  ) {
    return normalized;
  }
  return 'error';
}

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

export async function POST(request: Request) {
  const fallbackRequestId = resolveRequestId(request);

  try {
    const rawPayload = await request.json();
    const payload = readObject(rawPayload);
    if (Object.keys(payload).length === 0) {
      return buildErrorResponse(request, {
        status: 400,
        code: 'CLIENT_ERROR_REPORT_INVALID_PAYLOAD',
        userMessage: 'Invalid client error payload',
        developerMessage: 'Payload is missing or not an object',
      });
    }

    const userMessage =
      readString(payload.userMessage) ||
      readString(payload.message) ||
      'Unexpected client error';
    const developerMessage =
      readString(payload.developerMessage) || readString(payload.message);
    const requestId = readString(payload.requestId) || fallbackRequestId;
    const context = readObject(payload.context);
    const route =
      readString(payload.route) ||
      readString(context.pathname) ||
      readString(context.href) ||
      '/client';

    let actorUserId: string | undefined;
    try {
      const resolvedIdentity = await resolveSessionIdentityReadOnly(
        request.headers
      );
      if (resolvedIdentity.success && resolvedIdentity.data?.userId) {
        actorUserId = resolvedIdentity.data.userId;
      }
    } catch (identityError) {
      console.warn(
        '[ClientErrorReport] failed to resolve session identity:',
        identityError instanceof Error
          ? identityError.message
          : String(identityError)
      );
    }

    await recordErrorEvent({
      code: readString(payload.code) || 'CLIENT_RUNTIME_ERROR',
      source: 'frontend',
      severity: readSeverity(payload.severity),
      retryable: readBoolean(payload.retryable, true),
      userMessage,
      developerMessage: developerMessage || undefined,
      requestId,
      traceId: readString(payload.traceId) || undefined,
      actorUserId,
      httpStatus: readNumber(payload.httpStatus) || undefined,
      method: readString(payload.method) || 'CLIENT',
      route,
      context: {
        ...context,
        report_origin: 'browser',
        server_received_at: new Date().toISOString(),
        reporter_user_agent:
          request.headers.get('user-agent')?.slice(0, 1000) || null,
      },
    });

    const response = NextResponse.json(
      {
        success: true,
        request_id: requestId,
      },
      {
        status: 202,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  } catch (error) {
    console.error('[ClientErrorReport] failed to record client error:', error);
    return buildErrorResponse(request, {
      status: 500,
      code: 'CLIENT_ERROR_REPORT_FAILED',
      userMessage: 'Failed to record client error',
      developerMessage:
        error instanceof Error ? error.message : 'Unknown client error report failure',
    });
  }
}
