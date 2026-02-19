import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { resolveDifyConfig } from '../lib/dify-config';
import { buildRouteErrorPayload } from '../lib/route-error';
import { resolveIdentityFromSession } from '../lib/session-identity';

interface InternalDifyConfigRoutesOptions {
  config: ApiRuntimeConfig;
}

async function requireAdmin(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<
  | { ok: true }
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
        userMessage: 'Unauthorized access',
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
        userMessage: 'Failed to verify permissions',
      }),
    };
  }
  if (resolved.identity.role !== 'admin') {
    return {
      ok: false,
      statusCode: 403,
      payload: buildRouteErrorPayload({
        request,
        statusCode: 403,
        source: 'auth',
        code: 'AUTH_FORBIDDEN',
        userMessage: 'Insufficient permissions',
      }),
    };
  }
  return { ok: true };
}

export const internalDifyConfigRoutes: FastifyPluginAsync<
  InternalDifyConfigRoutesOptions
> = async (app, options) => {
  app.get<{
    Params: { appId: string };
    Querystring: { forceRefresh?: string };
  }>('/api/internal/dify-config/:appId', async (request, reply) => {
    try {
      const authResult = await requireAdmin(request, options.config);
      if (!authResult.ok) {
        return reply.status(authResult.statusCode).send(authResult.payload);
      }

      const appId = (request.params.appId || '').trim();
      if (!appId) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            code: 'DIFY_CONFIG_APP_ID_MISSING',
            userMessage: 'Missing appId',
            extra: {
              config: null,
            },
          })
        );
      }

      const config = await resolveDifyConfig(appId);
      return reply.send({
        success: true,
        config,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][internal-dify-config] GET failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          code: 'INTERNAL_DIFY_CONFIG_FAILED',
          userMessage: 'Internal server error',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown dify config retrieval error',
          extra: {
            config: null,
          },
        })
      );
    }
  });
};
