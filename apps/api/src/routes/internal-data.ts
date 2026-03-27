import type { FastifyPluginAsync } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { handleApiKeyAction } from './internal-data-route/api-key-actions';
import { handleAppExecutionAction } from './internal-data-route/app-execution-actions';
import { ensureActionPermission } from './internal-data-route/auth';
import { handleConversationAction } from './internal-data-route/conversation-actions';
import { handleErrorObservabilityAction } from './internal-data-route/error-observability-actions';
import { handleGroupAdminAction } from './internal-data-route/group-admin-actions';
import { handleGroupAuthAction } from './internal-data-route/group-auth-actions';
import {
  normalizePayload,
  normalizeRequestBody,
  readString,
  sendActionResponse,
  toErrorResponse,
  toFailureResponse,
} from './internal-data-route/helpers';
import { handleMessageAction } from './internal-data-route/message-actions';
import { handleProviderAction } from './internal-data-route/provider-actions';
import { handleServiceInstanceAction } from './internal-data-route/service-instance-actions';
import { handleSsoAction } from './internal-data-route/sso-actions';
import type { ApiActionResponse } from './internal-data-route/types';
import { handleUserAction } from './internal-data-route/user-actions';

interface InternalDataRoutesOptions {
  config: ApiRuntimeConfig;
}

function buildActionLogContext(
  action: string,
  payload: Record<string, unknown> | undefined
): Record<string, unknown> {
  const context: Record<string, unknown> = {
    action,
    payloadKeys: payload ? Object.keys(payload).sort() : [],
  };

  const conversationId = readString(payload?.conversationId);
  if (conversationId) {
    context.conversationId = conversationId;
  }

  const externalId = readString(payload?.externalId);
  if (externalId) {
    context.externalId = externalId;
  }

  const appId = readString(payload?.appId);
  if (appId) {
    context.appId = appId;
  }

  const conversation =
    payload?.conversation &&
    typeof payload.conversation === 'object' &&
    !Array.isArray(payload.conversation)
      ? (payload.conversation as Record<string, unknown>)
      : null;
  if (conversation) {
    const conversationExternalId = readString(conversation.external_id);
    if (conversationExternalId && !context.externalId) {
      context.externalId = conversationExternalId;
    }

    const conversationAppId = readString(conversation.app_id);
    if (conversationAppId && !context.appId) {
      context.appId = conversationAppId;
    }
  }

  const message =
    payload?.message &&
    typeof payload.message === 'object' &&
    !Array.isArray(payload.message)
      ? (payload.message as Record<string, unknown>)
      : null;
  if (message) {
    const messageConversationId = readString(message.conversation_id);
    if (messageConversationId && !context.conversationId) {
      context.conversationId = messageConversationId;
    }

    const messageRole = readString(message.role);
    if (messageRole) {
      context.messageRole = messageRole;
    }

    const messageExternalId = readString(message.external_id);
    if (messageExternalId) {
      context.messageExternalId = messageExternalId;
    }

    const messageContent = readString(message.content);
    if (messageContent) {
      context.messageLength = messageContent.length;
    }
  }

  return context;
}

function logActionOutcome(input: {
  request: Parameters<FastifyPluginAsync<InternalDataRoutesOptions>>[0]['log'];
  actionContext: Record<string, unknown>;
  statusCode: number;
  startedAt: number;
  actorUserId?: string;
  error?: unknown;
}): void {
  const durationMs = Date.now() - input.startedAt;

  if (input.statusCode >= 500) {
    input.request.error(
      {
        ...input.actionContext,
        statusCode: input.statusCode,
        durationMs,
        actorUserId: input.actorUserId,
        err: input.error,
      },
      '[FastifyAPI][internal-data] action failed'
    );
    return;
  }

  if (durationMs >= 1000) {
    input.request.warn(
      {
        ...input.actionContext,
        statusCode: input.statusCode,
        durationMs,
        actorUserId: input.actorUserId,
      },
      '[FastifyAPI][internal-data] slow action'
    );
  }
}

async function handleLocalInternalDataAction(
  action: string,
  payload: Record<string, unknown> | undefined,
  actorUserId: string | undefined
): Promise<ApiActionResponse | null> {
  const conversationResult = await handleConversationAction(
    action,
    payload,
    actorUserId
  );
  if (conversationResult) {
    return conversationResult;
  }

  const messageResult = await handleMessageAction(action, payload, actorUserId);
  if (messageResult) {
    return messageResult;
  }

  const executionResult = await handleAppExecutionAction(
    action,
    payload,
    actorUserId
  );
  if (executionResult) {
    return executionResult;
  }

  const groupAuthResult = await handleGroupAuthAction(
    action,
    payload,
    actorUserId
  );
  if (groupAuthResult) {
    return groupAuthResult;
  }

  const userResult = await handleUserAction(action, payload, actorUserId);
  if (userResult) {
    return userResult;
  }

  const groupAdminResult = await handleGroupAdminAction(action, payload);
  if (groupAdminResult) {
    return groupAdminResult;
  }

  const providerResult = await handleProviderAction(action, payload);
  if (providerResult) {
    return providerResult;
  }

  const serviceInstanceResult = await handleServiceInstanceAction(
    action,
    payload
  );
  if (serviceInstanceResult) {
    return serviceInstanceResult;
  }

  const apiKeyResult = await handleApiKeyAction(action, payload);
  if (apiKeyResult) {
    return apiKeyResult;
  }

  const ssoResult = await handleSsoAction(action, payload, actorUserId);
  if (ssoResult) {
    return ssoResult;
  }

  const errorObservabilityResult = await handleErrorObservabilityAction(
    action,
    payload
  );
  if (errorObservabilityResult) {
    return errorObservabilityResult;
  }

  return null;
}

export const internalDataRoutes: FastifyPluginAsync<
  InternalDataRoutesOptions
> = async (app, options) => {
  app.post('/api/internal/data', async (request, reply) => {
    const body = normalizeRequestBody(request.body);
    const action = readString(body.action);
    const payload = normalizePayload(body);
    const startedAt = Date.now();
    const actionContext = buildActionLogContext(action || '<missing>', payload);

    if (!action) {
      const response = toErrorResponse('Missing action', 400);
      return sendActionResponse(request, reply, response);
    }

    let actorUserId: string | undefined;

    try {
      const permission = await ensureActionPermission(
        request,
        options.config,
        action,
        payload
      );
      actorUserId = permission.actorUserId;
      if (permission.error) {
        logActionOutcome({
          request: request.log,
          actionContext,
          statusCode: permission.error.statusCode,
          startedAt,
          actorUserId,
        });
        return sendActionResponse(
          request,
          reply,
          permission.error,
          actorUserId
        );
      }

      const localHandled = await handleLocalInternalDataAction(
        action,
        payload,
        actorUserId
      );

      if (localHandled) {
        logActionOutcome({
          request: request.log,
          actionContext,
          statusCode: localHandled.statusCode,
          startedAt,
          actorUserId,
        });
        return sendActionResponse(request, reply, localHandled, actorUserId);
      }

      const unsupported = toErrorResponse(`Unsupported action: ${action}`, 400);
      logActionOutcome({
        request: request.log,
        actionContext,
        statusCode: unsupported.statusCode,
        startedAt,
        actorUserId,
      });
      return sendActionResponse(request, reply, unsupported, actorUserId);
    } catch (error) {
      const failed = toFailureResponse(error);
      logActionOutcome({
        request: request.log,
        actionContext,
        statusCode: failed.statusCode,
        startedAt,
        actorUserId,
        error,
      });
      return sendActionResponse(request, reply, failed, actorUserId);
    }
  });
};
