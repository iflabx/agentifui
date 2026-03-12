import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import {
  REQUEST_ID_HEADER,
  buildApiErrorDetail,
  buildApiErrorEnvelope,
} from '../lib/app-error';
import { recordFrontendErrorEvent } from '../lib/frontend-error-events';
import { resolveIdentityFromSession } from '../lib/session-identity';

interface InternalErrorEventsClientRoutesOptions {
  config: ApiRuntimeConfig;
}

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

function readHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (Array.isArray(value)) {
    const joined = value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .find(Boolean);
    return joined || null;
  }

  return null;
}

function resolveRequestId(request: FastifyRequest): string {
  return (
    readHeaderValue(request.headers[REQUEST_ID_HEADER]) ||
    readHeaderValue(request.headers['x-requestid']) ||
    readHeaderValue(request.headers['x-correlation-id']) ||
    request.id
  );
}

function buildErrorPayload(input: {
  requestId: string;
  statusCode: number;
  code: string;
  userMessage: string;
  developerMessage: string;
}) {
  const detail = buildApiErrorDetail({
    status: input.statusCode,
    source: 'fastify-api',
    code: input.code,
    userMessage: input.userMessage,
    developerMessage: input.developerMessage,
    requestId: input.requestId,
  });

  return buildApiErrorEnvelope(detail, input.userMessage);
}

function applyCommonHeaders(
  requestId: string,
  reply: {
    header: (name: string, value: string) => unknown;
  }
) {
  reply.header('Cache-Control', 'no-store');
  reply.header(REQUEST_ID_HEADER, requestId);
}

export const internalErrorEventsClientRoutes: FastifyPluginAsync<
  InternalErrorEventsClientRoutesOptions
> = async (app, options) => {
  app.post<{ Body: unknown }>(
    '/api/internal/error-events/client',
    async (request, reply) => {
      const fallbackRequestId = resolveRequestId(request);

      try {
        const payload = readObject(request.body);
        if (Object.keys(payload).length === 0) {
          applyCommonHeaders(fallbackRequestId, reply);
          return reply.status(400).send(
            buildErrorPayload({
              requestId: fallbackRequestId,
              statusCode: 400,
              code: 'CLIENT_ERROR_REPORT_INVALID_PAYLOAD',
              userMessage: 'Invalid client error payload',
              developerMessage: 'Payload is missing or not an object',
            })
          );
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
          const resolvedIdentity = await resolveIdentityFromSession(
            request,
            options.config
          );
          if (resolvedIdentity.kind === 'ok') {
            actorUserId = resolvedIdentity.identity.userId;
          } else if (resolvedIdentity.kind === 'error') {
            request.log.warn(
              { reason: resolvedIdentity.reason },
              '[FastifyAPI][internal-error-events-client] failed to resolve session identity'
            );
          }
        } catch (identityError) {
          request.log.warn(
            { err: identityError },
            '[FastifyAPI][internal-error-events-client] failed to resolve session identity'
          );
        }

        await recordFrontendErrorEvent({
          code: readString(payload.code) || 'CLIENT_RUNTIME_ERROR',
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
              readHeaderValue(request.headers['user-agent'])?.slice(0, 1000) ||
              null,
          },
        });

        applyCommonHeaders(requestId, reply);
        return reply.status(202).send({
          success: true,
          request_id: requestId,
        });
      } catch (error) {
        request.log.error(
          { err: error },
          '[FastifyAPI][internal-error-events-client] POST failed'
        );
        applyCommonHeaders(fallbackRequestId, reply);
        return reply.status(500).send(
          buildErrorPayload({
            requestId: fallbackRequestId,
            statusCode: 500,
            code: 'CLIENT_ERROR_REPORT_FAILED',
            userMessage: 'Failed to record client error',
            developerMessage:
              error instanceof Error
                ? error.message
                : 'Unknown client error report failure',
          })
        );
      }
    }
  );
};
