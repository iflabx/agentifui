import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../../config';
import { REQUEST_ID_HEADER } from '../../lib/app-error';
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

  await dispatchDifyUpstreamRequest(
    request,
    reply,
    contextResult.context,
    targetConfigResult.targetConfig
  );
}
