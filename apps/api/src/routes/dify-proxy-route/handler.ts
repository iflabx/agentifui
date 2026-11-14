import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../../config';
import { readAgentAdmissionLimits } from '../../lib/agent-app';
import { AgentPolicyError, isDifyGeneration } from '../../lib/agent-backends';
import {
  ROOT_TASK_HEADER,
  SUBMISSION_HEADER,
  admitSubmission,
  registerSubmission,
  rejectSubmission,
  submissionHash,
  submissionId,
  submissionStorage,
} from '../../lib/agent-submissions';
import { REQUEST_ID_HEADER } from '../../lib/app-error';
import { buildAppErrorPayload } from './error-handling';
import {
  adjustApiPathByAppType,
  buildScopedUpstreamQuery,
  extractRawQuery,
  isObjectRecord,
} from './helpers';
import { runInputModeration } from './input-moderation';
import { resolveProxyRequestContext } from './request-context';
import { requiresDifyResourceAdmin } from './resource-access';
import { resolveDifyTargetConfig } from './target-config';
import { dispatchDifyUpstreamRequest } from './upstream';

export async function handleDifyProxy(
  request: FastifyRequest,
  reply: FastifyReply,
  config: ApiRuntimeConfig
): Promise<void> {
  try {
    await handleDifyProxyRequest(request, reply, config);
  } catch (error) {
    if (!(error instanceof AgentPolicyError)) throw error;
    if (reply.sent || reply.raw.headersSent) return;
    reply.status(error.statusCode).send(
      await buildAppErrorPayload({
        request,
        status: error.statusCode,
        source: 'dify-proxy',
        route: request.url,
        method: request.method,
        code: error.code,
        message: error.code,
      })
    );
  }
}

async function handleDifyProxyRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  config: ApiRuntimeConfig
): Promise<void> {
  reply.header(REQUEST_ID_HEADER, request.id);

  if (request.method === 'OPTIONS') {
    reply.status(204).send();
    return;
  }

  const contextResult = await resolveProxyRequestContext(request, config);
  if (!contextResult.ok) {
    reply.status(contextResult.status).send(contextResult.payload);
    return;
  }

  const targetConfigResult = await resolveDifyTargetConfig(
    request,
    config,
    contextResult.context
  );
  if (!targetConfigResult.ok) {
    reply.status(targetConfigResult.status).send(targetConfigResult.payload);
    return;
  }

  if (
    contextResult.context.actor.role !== 'admin' &&
    requiresDifyResourceAdmin(
      contextResult.context.slug,
      targetConfigResult.targetConfig.appType
    )
  ) {
    reply.status(403).send(
      await buildAppErrorPayload({
        request,
        status: 403,
        source: 'dify-proxy',
        route: contextResult.context.routePath,
        method: request.method,
        actorUserId: contextResult.context.actor.userId,
        code: 'DIFY_RESOURCE_ADMIN_REQUIRED',
        message:
          'This operation requires administrator access until resource ownership can be verified.',
      })
    );
    return;
  }

  const context = contextResult.context;
  const target = targetConfigResult.targetConfig;
  const path = adjustApiPathByAppType(context.slug, target.appType);
  if (/human-input|human_input|\/resume(?:\/|$)/.test(path))
    throw new AgentPolicyError(409, 'AGENT_CAPABILITY_UNSUPPORTED');
  let rootTaskId: string | undefined;
  if (!target.tempConfigUsed && isDifyGeneration(request.method, path)) {
    if (!target.serviceInstanceId)
      throw new AgentPolicyError(503, 'AGENT_GOVERNANCE_UNAVAILABLE');
    if (!isObjectRecord(target.rawBody))
      throw new AgentPolicyError(400, 'DIFY_PROXY_GENERATION_BODY_INVALID');
    const registration = await registerSubmission({
      userId: context.actor.userId,
      serviceInstanceId: target.serviceInstanceId,
      credentialVersion: target.credentialVersion,
      submissionId: submissionId(request.headers[SUBMISSION_HEADER]),
      backendType: 'dify',
      targetFingerprint: submissionHash([
        target.serviceInstanceId,
        new URL(target.difyApiUrl).toString().replace(/\/+$/, ''),
        target.appInstanceId ?? context.appId,
      ]),
      request: {
        path,
        query: buildScopedUpstreamQuery({
          rawQuery: extractRawQuery(request.raw.url),
          slugPath: path,
          actorUserId: context.actor.userId,
        }),
        body: target.rawBody,
      },
    });
    rootTaskId = registration.task.root_task_id;
    reply.header(ROOT_TASK_HEADER, rootTaskId);
    if (registration.replayed) {
      throw new AgentPolicyError(
        409,
        registration.task.error_code ?? 'AGENT_SUBMISSION_REPLAY'
      );
    }
  }

  const moderationResult = await runInputModeration({
    request,
    config,
    context: { ...context, slug: path.split('/') },
    targetConfig: targetConfigResult.targetConfig,
  });
  if (moderationResult.outcome === 'block') {
    if (rootTaskId)
      await rejectSubmission(rootTaskId, 'CONTENT_MODERATION_BLOCKED');
    const categorySuffix =
      moderationResult.categories.length > 0
        ? ` Categories: ${moderationResult.categories.join(', ')}`
        : '';
    reply.status(400).send(
      await buildAppErrorPayload({
        request,
        status: 400,
        source: 'dify-proxy',
        route: contextResult.context.routePath,
        method: request.method,
        actorUserId: contextResult.context.actor.userId,
        code: 'CONTENT_MODERATION_BLOCKED',
        message: `Input moderation blocked the request.${categorySuffix}`,
        ...(moderationResult.categories.length > 0
          ? {
              context: {
                moderation_categories: moderationResult.categories,
              },
            }
          : {}),
      })
    );
    return;
  }

  if (moderationResult.outcome === 'unavailable') {
    if (rootTaskId)
      await rejectSubmission(rootTaskId, 'CONTENT_MODERATION_UNAVAILABLE');
    reply.status(503).send(
      await buildAppErrorPayload({
        request,
        status: 503,
        source: 'dify-proxy',
        route: contextResult.context.routePath,
        method: request.method,
        actorUserId: contextResult.context.actor.userId,
        code: 'CONTENT_MODERATION_UNAVAILABLE',
        message: `Input moderation is unavailable. ${moderationResult.reason}`,
      })
    );
    return;
  }

  if (rootTaskId) {
    try {
      await submissionStorage(client =>
        admitSubmission(
          client,
          rootTaskId!,
          context.actor.userId,
          target.serviceInstanceId!,
          readAgentAdmissionLimits()
        )
      );
    } catch (error) {
      if (error instanceof AgentPolicyError && error.statusCode < 500)
        await rejectSubmission(rootTaskId, error.code);
      throw error;
    }
    target.rootTaskId = rootTaskId;
  }
  await dispatchDifyUpstreamRequest(
    request,
    reply,
    contextResult.context,
    targetConfigResult.targetConfig
  );
  if (rootTaskId) await rejectSubmission(rootTaskId, 'AGENT_NOT_DISPATCHED');
}
