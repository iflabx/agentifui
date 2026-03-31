import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../../config';
import { REQUEST_ID_HEADER } from '../../lib/app-error';
import { buildAppErrorPayload } from './error-handling';
import { runInputModeration } from './input-moderation';
import { resolveProxyRequestContext } from './request-context';
import { resolveDifyTargetConfig } from './target-config';
import { dispatchDifyUpstreamRequest } from './upstream';

export async function handleDifyProxy(
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

  const moderationResult = await runInputModeration({
    request,
    config,
    context: contextResult.context,
    targetConfig: targetConfigResult.targetConfig,
  });
  if (moderationResult.outcome === 'block') {
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

  await dispatchDifyUpstreamRequest(
    request,
    reply,
    contextResult.context,
    targetConfigResult.targetConfig
  );
}
