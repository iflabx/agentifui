import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { buildRouteErrorPayload } from '../lib/route-error';
import { resolveIdentityFromSession } from '../lib/upstream-session';

interface AdminUsersForGroupRoutesOptions {
  config: ApiRuntimeConfig;
}

interface UserRow {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string | null;
  status: string | null;
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

export const adminUsersForGroupRoutes: FastifyPluginAsync<
  AdminUsersForGroupRoutesOptions
> = async (app, options) => {
  app.post<{
    Body: {
      page?: number;
      pageSize?: number;
      search?: string;
      excludeUserIds?: unknown[];
    };
  }>('/api/admin/users/for-group', async (request, reply) => {
    try {
      const authResult = await requireAdmin(request, options.config);
      if (!authResult.ok) {
        return reply.status(authResult.statusCode).send(authResult.payload);
      }

      const page = Number(request.body?.page) || 1;
      const pageSize = Number(request.body?.pageSize) || 10;
      const safePage = Math.max(1, page);
      const safePageSize = Math.min(100, Math.max(1, pageSize));
      const offset = (safePage - 1) * safePageSize;
      const trimmedSearch =
        typeof request.body?.search === 'string'
          ? request.body.search.trim()
          : '';

      const whereClauses: string[] = [`status = 'active'`];
      const params: unknown[] = [];

      if (trimmedSearch.length > 0) {
        params.push(`%${trimmedSearch}%`);
        const searchParamIndex = params.length;
        whereClauses.push(
          `(username ILIKE $${searchParamIndex} OR full_name ILIKE $${searchParamIndex} OR email ILIKE $${searchParamIndex})`
        );
      }

      if (
        Array.isArray(request.body?.excludeUserIds) &&
        request.body.excludeUserIds.length > 0
      ) {
        const sanitizedIds = request.body.excludeUserIds.filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0
        );
        if (sanitizedIds.length > 0) {
          params.push(sanitizedIds);
          const excludeParamIndex = params.length;
          whereClauses.push(`NOT (id = ANY($${excludeParamIndex}::uuid[]))`);
        }
      }

      const whereSql = whereClauses.join(' AND ');
      const countRows = await queryRowsWithPgSystemContext<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM profiles WHERE ${whereSql}`,
        params
      );
      const total = Number(countRows[0]?.total || 0);

      params.push(safePageSize);
      const limitParamIndex = params.length;
      params.push(offset);
      const offsetParamIndex = params.length;

      const users = await queryRowsWithPgSystemContext<UserRow>(
        `
          SELECT
            id::text,
            username,
            full_name,
            email,
            avatar_url,
            role::text,
            status::text
          FROM profiles
          WHERE ${whereSql}
          ORDER BY created_at DESC
          LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
        `,
        params
      );

      const totalPages = Math.ceil(total / safePageSize);
      const formattedUsers = users.map(user => ({
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        avatar_url: user.avatar_url,
        role: user.role,
        status: user.status,
      }));

      return reply.send({
        users: formattedUsers,
        page: safePage,
        pageSize: safePageSize,
        total,
        totalPages,
        success: true,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][admin-users-for-group] POST failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          code: 'ADMIN_GROUP_USERS_READ_FAILED',
          userMessage: 'Server internal error',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown admin group users read error',
        })
      );
    }
  });
};
