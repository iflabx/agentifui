import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { buildRouteErrorPayload } from '../lib/route-error';
import { resolveIdentityFromSession } from '../lib/upstream-session';

interface AdminStatusRoutesOptions {
  config: ApiRuntimeConfig;
}

interface ProviderRow {
  id: string;
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
        code: 'AUTH_PERMISSION_VERIFY_FAILED',
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

export const adminStatusRoutes: FastifyPluginAsync<
  AdminStatusRoutesOptions
> = async (app, options) => {
  app.get('/api/admin/status', async (request, reply) => {
    try {
      const authResult = await requireAdmin(request, options.config);
      if (!authResult.ok) {
        return reply.status(authResult.statusCode).send(authResult.payload);
      }

      const providers = await queryRowsWithPgSystemContext<ProviderRow>(
        `
            SELECT id::text
            FROM providers
            WHERE is_active = TRUE
          `
      );

      let hasActiveInstances = false;
      if (providers.length > 0) {
        const rows = await queryRowsWithPgSystemContext<{ found: number }>(
          `
              SELECT 1 AS found
              FROM service_instances
              WHERE provider_id = ANY($1::uuid[])
              LIMIT 1
            `,
          [providers.map(provider => provider.id)]
        );
        hasActiveInstances = Boolean(rows[0]);
      }

      return reply.send({
        hasActiveProviders: providers.length > 0,
        hasActiveInstances,
        providersCount: providers.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][admin-status] GET failed'
      );
      return reply.status(500).send({
        ...buildRouteErrorPayload({
          request,
          statusCode: 500,
          code: 'ADMIN_STATUS_READ_FAILED',
          userMessage: 'Failed to get status information',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown admin status read error',
        }),
        hasActiveProviders: false,
        hasActiveInstances: false,
      });
    }
  });
};
