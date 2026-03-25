import type { FastifyRequest } from 'fastify';

import {
  type AgentErrorSource,
  toUserFacingAgentError,
} from '../../lib/agent-error';
import {
  buildApiErrorDetail,
  buildApiErrorEnvelope,
} from '../../lib/app-error';
import { recordApiErrorEvent } from '../../lib/error-events';
import { isObjectRecord, resolveRequestLocale } from './helpers';
import type { LogDifyProxyFailureInput } from './types';

function extractErrorCode(payload: unknown): string | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  const maybeCode = payload.code;
  return typeof maybeCode === 'string' ? maybeCode : null;
}

function extractErrorMessage(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed || null;
  }

  if (!isObjectRecord(payload)) {
    return null;
  }

  const messageCandidates = [payload.message, payload.error, payload.details];
  for (const candidate of messageCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  const nestedData = payload.data;
  if (isObjectRecord(nestedData)) {
    const status = nestedData.status;
    if (status === 'failed') {
      const nestedError = nestedData.error;
      if (typeof nestedError === 'string' && nestedError.trim().length > 0) {
        return nestedError.trim();
      }
    }
  }

  return null;
}

function buildLogPreview(content: string, maxLength = 240): string | null {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

export function logDifyProxyFailure(
  request: FastifyRequest,
  input: LogDifyProxyFailureInput
): void {
  const logPayload: Record<string, unknown> = {
    appId: input.appId,
    route: input.routePath,
    slugPath: input.slugPath,
    method: request.method,
    agentSource: input.agentSource,
    failureKind: input.failureKind,
    upstreamStatus: input.upstreamStatus,
    upstreamContentType: input.upstreamContentType,
    upstreamErrorCode: input.upstreamErrorCode,
    retryAfterSeconds: input.retryAfterSeconds,
    elapsedMs: input.elapsedMs,
  };

  if (typeof input.responseBody === 'string') {
    logPayload.responseBytes = Buffer.byteLength(input.responseBody);
    const responsePreview = buildLogPreview(input.responseBody);
    if (responsePreview) {
      logPayload.responsePreview = responsePreview;
    }
  }

  if (input.level === 'error') {
    if (input.error) {
      request.log.error(
        { err: input.error, ...logPayload },
        '[FastifyDifyProxy] non-stream failure'
      );
      return;
    }
    request.log.error(logPayload, '[FastifyDifyProxy] non-stream failure');
    return;
  }

  if (input.error) {
    request.log.warn(
      { err: input.error, ...logPayload },
      '[FastifyDifyProxy] non-stream failure'
    );
    return;
  }

  request.log.warn(logPayload, '[FastifyDifyProxy] non-stream failure');
}

export async function withAgentErrorEnvelope(
  payload: unknown,
  context: {
    source: AgentErrorSource;
    status: number;
    locale?: string;
    requestId: string;
    route: string;
    method: string;
    actorUserId?: string;
  }
): Promise<unknown> {
  const rawMessage = extractErrorMessage(payload);
  if (!rawMessage) {
    return payload;
  }

  const agentError = toUserFacingAgentError({
    source: context.source,
    status: context.status,
    code: extractErrorCode(payload),
    message: rawMessage,
    locale: context.locale,
  });
  const appError = buildApiErrorDetail({
    status: context.status,
    code: agentError.code,
    source: 'dify-proxy',
    requestId: context.requestId,
    userMessage: agentError.userMessage,
    developerMessage: rawMessage,
    retryable: agentError.retryable,
    context: {
      agent_source: agentError.source,
      agent_kind: agentError.kind,
      suggestion: agentError.suggestion,
    },
  });

  const appEnvelope = buildApiErrorEnvelope(appError, rawMessage);
  void recordApiErrorEvent({
    detail: appError,
    statusCode: context.status,
    method: context.method,
    route: context.route,
    actorUserId: context.actorUserId,
  }).catch(error => {
    console.warn(
      '[FastifyDifyProxy] failed to record error event:',
      error instanceof Error ? error.message : String(error)
    );
  });

  const normalizedPayload = isObjectRecord(payload)
    ? payload
    : {
        success: false,
        error: rawMessage,
      };

  return {
    ...normalizedPayload,
    ...appEnvelope,
    agent_error: agentError,
  };
}

export function buildAppErrorPayload(input: {
  request: FastifyRequest;
  status: number;
  source: AgentErrorSource;
  route: string;
  method: string;
  actorUserId?: string;
  code: string;
  message: string;
}): Promise<unknown> {
  return withAgentErrorEnvelope(
    {
      code: input.code,
      error: input.message,
      message: input.message,
    },
    {
      source: input.source,
      status: input.status,
      locale: resolveRequestLocale(input.request.headers['accept-language']),
      requestId: input.request.id,
      route: input.route,
      method: input.method,
      actorUserId: input.actorUserId,
    }
  );
}
