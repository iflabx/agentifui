import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { getRealtimeBrokerStats } from '../lib/realtime/broker';
import {
  getRealtimeSubscriptionStats,
  listRealtimeSubscriptions,
} from '../lib/realtime/subscription-registry';
import { buildRouteErrorPayload } from '../lib/route-error';
import {
  type ActorIdentity,
  resolveIdentityFromSession,
} from '../lib/session-identity';

interface InternalRealtimeStatsRoutesOptions {
  config: ApiRuntimeConfig;
}

async function requireActor(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<
  | { ok: true; actor: ActorIdentity }
  | { ok: false; statusCode: number; payload: Record<string, unknown> }
> {
  const resolved = await resolveIdentityFromSession(request, config);
  if (resolved.kind === 'unauthorized') {
    return {
      ok: false,
      statusCode: 401,
      payload: buildRouteErrorPayload({
        request,
        statusCode: 401,
        source: 'auth',
        code: 'AUTH_UNAUTHORIZED',
        userMessage: 'Unauthorized',
      }),
    };
  }
  if (resolved.kind === 'error') {
    return {
      ok: false,
      statusCode: 500,
      payload: buildRouteErrorPayload({
        request,
        statusCode: 500,
        source: 'auth',
        code: 'AUTH_VERIFY_FAILED',
        userMessage: 'Failed to verify session',
      }),
    };
  }
  return {
    ok: true,
    actor: resolved.identity,
  };
}

export const internalRealtimeStatsRoutes: FastifyPluginAsync<
  InternalRealtimeStatsRoutesOptions
> = async (app, options) => {
  app.get('/api/internal/realtime/stats', async (request, reply) => {
    try {
      const auth = await requireActor(request, options.config);
      if (!auth.ok) {
        return reply.status(auth.statusCode).send(auth.payload);
      }

      if (auth.actor.role !== 'admin') {
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

      const stats = getRealtimeSubscriptionStats();
      const subscriptions = listRealtimeSubscriptions();
      const broker = await getRealtimeBrokerStats();

      return reply.send({
        success: true,
        stats,
        subscriptions,
        broker,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][internal-realtime-stats] GET failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          code: 'INTERNAL_REALTIME_STATS_FAILED',
          userMessage: 'Failed to get realtime stats',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown realtime stats retrieval error',
        })
      );
    }
  });
};
