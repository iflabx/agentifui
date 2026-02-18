import type { FastifyRequest } from 'fastify';

import {
  type ApiErrorSource,
  buildApiErrorDetail,
  buildApiErrorEnvelope,
} from './app-error';

interface BuildRouteErrorPayloadInput {
  request: FastifyRequest;
  statusCode: number;
  userMessage: string;
  code?: string;
  source?: ApiErrorSource;
  developerMessage?: string;
  context?: Record<string, unknown>;
  retryable?: boolean;
  legacyMessage?: string;
  extra?: Record<string, unknown>;
}

export function buildRouteErrorPayload(
  input: BuildRouteErrorPayloadInput
): Record<string, unknown> {
  const detail = buildApiErrorDetail({
    status: input.statusCode,
    source: input.source || 'fastify-api',
    code: input.code,
    userMessage: input.userMessage,
    developerMessage: input.developerMessage,
    context: input.context,
    retryable: input.retryable,
    requestId: input.request.id,
  });

  return {
    ...buildApiErrorEnvelope(detail, input.legacyMessage || input.userMessage),
    ...(input.extra || {}),
  };
}
