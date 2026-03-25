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

    if (!action) {
      const response = toErrorResponse('Missing action', 400);
      return sendActionResponse(request, reply, response);
    }

    try {
      const permission = await ensureActionPermission(
        request,
        options.config,
        action,
        payload
      );
      if (permission.error) {
        return sendActionResponse(
          request,
          reply,
          permission.error,
          permission.actorUserId
        );
      }

      const localHandled = await handleLocalInternalDataAction(
        action,
        payload,
        permission.actorUserId
      );

      if (localHandled) {
        return sendActionResponse(
          request,
          reply,
          localHandled,
          permission.actorUserId
        );
      }

      const unsupported = toErrorResponse(`Unsupported action: ${action}`, 400);
      return sendActionResponse(
        request,
        reply,
        unsupported,
        permission.actorUserId
      );
    } catch (error) {
      const failed = toFailureResponse(error);
      return sendActionResponse(request, reply, failed);
    }
  });
};
