import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { resolveIdentityFromSession } from '../lib/upstream-session';

interface AdminUsersRoutesOptions {
  config: ApiRuntimeConfig;
}

interface UserRow {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  role: string | null;
  status: string | null;
}

async function requireAdmin(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<
  | { ok: true }
  | { ok: false; statusCode: number; payload: Record<string, string> }
> {
  const resolved = await resolveIdentityFromSession(request, config);
  if (resolved.kind === 'unauthorized') {
    return {
      ok: false,
      statusCode: 401,
      payload: { error: 'Unauthorized access' },
    };
  }
  if (resolved.kind === 'error') {
    return {
      ok: false,
      statusCode: 500,
      payload: { error: 'Failed to verify permissions' },
    };
  }
  if (resolved.identity.role !== 'admin') {
    return {
      ok: false,
      statusCode: 403,
      payload: { error: 'Insufficient permissions' },
    };
  }
  return { ok: true };
}

export const adminUsersRoutes: FastifyPluginAsync<
  AdminUsersRoutesOptions
> = async (app, options) => {
  app.get('/api/admin/users', async (request, reply) => {
    try {
      const authResult = await requireAdmin(request, options.config);
      if (!authResult.ok) {
        return reply.status(authResult.statusCode).send(authResult.payload);
      }

      const users = await queryRowsWithPgSystemContext<UserRow>(
        `
            SELECT
              id::text,
              full_name,
              username,
              avatar_url,
              role::text,
              status::text
            FROM profiles
            WHERE status = 'active'
            ORDER BY full_name ASC NULLS LAST, username ASC NULLS LAST, created_at DESC
          `
      );

      const formattedUsers = users.map(user => ({
        id: user.id,
        full_name: user.full_name || user.username || 'Unknown user',
        username: user.username,
        avatar_url: user.avatar_url,
        role: user.role,
        status: user.status,
      }));

      return reply.send({
        users: formattedUsers,
        success: true,
      });
    } catch (error) {
      request.log.error({ err: error }, '[FastifyAPI][admin-users] GET failed');
      return reply.status(500).send({ error: 'Server internal error' });
    }
  });
};
