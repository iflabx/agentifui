import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  REQUEST_ID_HEADER,
  buildApiErrorDetail,
  buildApiErrorEnvelope,
  maybeReadLegacyError,
} from '../../../lib/app-error';
import { recordApiErrorEvent } from '../../../lib/error-events';
import { type ApiActionResponse, INTERNAL_DATA_HANDLER_HEADER } from '../types';

export function toErrorResponse(
  message: string,
  statusCode: number
): ApiActionResponse {
  return {
    statusCode,
    contentType: 'application/json',
    payload: {
      error: message,
    },
    handler: 'local',
  };
}

export function toSuccessResponse(data: unknown): ApiActionResponse {
  return {
    statusCode: 200,
    contentType: 'application/json',
    payload: {
      success: true,
      data,
    },
    handler: 'local',
  };
}

export function toFailureResponse(error: unknown): ApiActionResponse {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'Unknown error';
  return {
    statusCode: 500,
    contentType: 'application/json',
    payload: {
      error: message,
    },
    handler: 'local',
  };
}

export function enrichResponsePayload(
  request: FastifyRequest,
  payload: unknown,
  statusCode: number,
  actorUserId?: string
): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    if (statusCode >= 400) {
      const detail = buildApiErrorDetail({
        status: statusCode,
        source: 'internal-data',
        requestId: request.id,
        userMessage: 'Request failed',
      });
      void recordApiErrorEvent({
        detail,
        statusCode,
        method: request.method,
        route: request.url,
        actorUserId,
      }).catch(error => {
        request.log.warn(
          { err: error },
          '[FastifyAPI][internal-data] failed to record error event'
        );
      });
      return buildApiErrorEnvelope(detail, 'Request failed');
    }
    return payload;
  }

  const payloadObject = payload as Record<string, unknown>;
  const success = payloadObject.success;
  const legacyMessage = maybeReadLegacyError(payloadObject);
  const hasLegacyErrorMessage = legacyMessage.length > 0;
  const shouldTreatAsError =
    success === false || (statusCode >= 400 && hasLegacyErrorMessage);

  if (shouldTreatAsError) {
    if (success !== false) {
      payloadObject.success = false;
    }

    if (!payloadObject.error && hasLegacyErrorMessage) {
      payloadObject.error = legacyMessage;
    }

    if (!payloadObject.request_id) {
      payloadObject.request_id = request.id;
    }

    if (!payloadObject.app_error) {
      const resolvedMessage = legacyMessage || 'Request failed';
      const detail = buildApiErrorDetail({
        status: statusCode,
        source: 'internal-data',
        requestId: request.id,
        userMessage: resolvedMessage,
      });
      payloadObject.app_error = detail;
      void recordApiErrorEvent({
        detail,
        statusCode,
        method: request.method,
        route: request.url,
        actorUserId,
      }).catch(error => {
        request.log.warn(
          { err: error },
          '[FastifyAPI][internal-data] failed to record error event'
        );
      });
    }
    return payloadObject;
  }

  if (success === true && !payloadObject.request_id) {
    payloadObject.request_id = request.id;
  }

  return payloadObject;
}

export function sendActionResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  response: ApiActionResponse,
  actorUserId?: string
) {
  return reply
    .status(response.statusCode)
    .header('content-type', response.contentType)
    .header(INTERNAL_DATA_HANDLER_HEADER, response.handler)
    .header(REQUEST_ID_HEADER, request.id)
    .send(
      enrichResponsePayload(
        request,
        response.payload,
        response.statusCode,
        actorUserId
      )
    );
}
