import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../../config';
import {
  getDifyProxyCircuitSnapshot,
  getDifyProxyResilienceMetricsSnapshot,
} from '../../lib/dify-proxy-resilience';
import { buildRouteErrorPayload } from '../../lib/route-error';
import { resolveIdentityFromSession } from '../../lib/session-identity';

export async function handleDifyResilienceOps(
  request: FastifyRequest,
  reply: FastifyReply,
  config: ApiRuntimeConfig
): Promise<FastifyReply> {
  const identity = await resolveIdentityFromSession(request, config);
  if (identity.kind !== 'ok') {
    return reply.status(401).send(
      buildRouteErrorPayload({
        request,
        statusCode: 401,
        source: 'auth',
        code: 'AUTH_UNAUTHORIZED',
        userMessage: 'Unauthorized',
      })
    );
  }

  if (identity.identity.role !== 'admin') {
    return reply.status(403).send(
      buildRouteErrorPayload({
        request,
        statusCode: 403,
        source: 'auth',
        code: 'AUTH_FORBIDDEN',
        userMessage: 'Forbidden',
      })
    );
  }

  const circuitKey = (
    request.query as Record<string, string | undefined>
  )?.circuitKey?.trim();

  return reply.send({
    success: true,
    metrics: {
      local: getDifyProxyResilienceMetricsSnapshot(),
      shared: null,
      sharedEnabled: false,
    },
    circuit: circuitKey
      ? {
          key: circuitKey,
          local: getDifyProxyCircuitSnapshot(circuitKey),
          shared: null,
        }
      : null,
  });
}
