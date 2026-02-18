import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { buildRouteErrorPayload } from '../lib/route-error';
import { resolveIdentityFromSession } from '../lib/upstream-session';

interface AdminAuthFallbackPolicyUserRoutesOptions {
  config: ApiRuntimeConfig;
}

interface ProfileLocalLoginStateRow {
  id: string;
  email: string | null;
  auth_source: string | null;
  local_login_enabled: boolean | null;
  local_login_updated_at: string | Date | null;
  fallback_password_set_at: string | Date | null;
  fallback_password_updated_by: string | null;
}

interface UserLocalLoginState {
  userId: string;
  email: string | null;
  authSource: string | null;
  localLoginEnabled: boolean;
  localLoginUpdatedAt: string | null;
  fallbackPasswordSetAt: string | null;
  fallbackPasswordUpdatedBy: string | null;
}

function toIsoString(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function toUserLocalLoginState(
  row: ProfileLocalLoginStateRow
): UserLocalLoginState {
  return {
    userId: row.id,
    email: row.email ?? null,
    authSource: row.auth_source ?? null,
    localLoginEnabled: Boolean(row.local_login_enabled),
    localLoginUpdatedAt: toIsoString(row.local_login_updated_at),
    fallbackPasswordSetAt: toIsoString(row.fallback_password_set_at),
    fallbackPasswordUpdatedBy: row.fallback_password_updated_by ?? null,
  };
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

async function getUserLocalLoginStateByUserId(
  userId: string
): Promise<UserLocalLoginState | null> {
  const rows = await queryRowsWithPgSystemContext<ProfileLocalLoginStateRow>(
    `
      SELECT
        id::text AS id,
        email,
        auth_source,
        local_login_enabled,
        local_login_updated_at,
        fallback_password_set_at,
        fallback_password_updated_by::text AS fallback_password_updated_by
      FROM profiles
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [userId]
  );

  if (!rows[0]) {
    return null;
  }

  return toUserLocalLoginState(rows[0]);
}

async function setUserLocalLoginEnabledByUserId(
  userId: string,
  enabled: boolean
): Promise<UserLocalLoginState | null> {
  const rows = await queryRowsWithPgSystemContext<ProfileLocalLoginStateRow>(
    `
      UPDATE profiles
      SET
        local_login_enabled = $2,
        local_login_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING
        id::text AS id,
        email,
        auth_source,
        local_login_enabled,
        local_login_updated_at,
        fallback_password_set_at,
        fallback_password_updated_by::text AS fallback_password_updated_by
    `,
    [userId, enabled]
  );

  if (!rows[0]) {
    return null;
  }

  return toUserLocalLoginState(rows[0]);
}

export const adminAuthFallbackPolicyUserRoutes: FastifyPluginAsync<
  AdminAuthFallbackPolicyUserRoutesOptions
> = async (app, options) => {
  app.get<{
    Params: { userId: string };
  }>(
    '/api/admin/auth/fallback-policy/users/:userId',
    async (request, reply) => {
      const authResult = await requireAdmin(request, options.config);
      if (!authResult.ok) {
        return reply.status(authResult.statusCode).send(authResult.payload);
      }

      const userId = (request.params.userId || '').trim();
      if (!userId) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            code: 'USER_ID_REQUIRED',
            userMessage: 'userId is required',
          })
        );
      }

      try {
        const state = await getUserLocalLoginStateByUserId(userId);
        if (!state) {
          return reply.status(404).send(
            buildRouteErrorPayload({
              request,
              statusCode: 404,
              code: 'USER_NOT_FOUND',
              userMessage: 'User not found',
            })
          );
        }

        return reply.send({
          success: true,
          data: state,
        });
      } catch (error) {
        request.log.error(
          { err: error },
          '[FastifyAPI][admin-auth-fallback-policy-user] GET failed'
        );
        return reply.status(500).send(
          buildRouteErrorPayload({
            request,
            statusCode: 500,
            code: 'USER_FALLBACK_STATE_READ_FAILED',
            userMessage: 'Failed to read user fallback state',
            developerMessage:
              error instanceof Error
                ? error.message
                : 'Unknown user fallback state read error',
          })
        );
      }
    }
  );

  app.patch<{
    Params: { userId: string };
    Body: { localLoginEnabled?: unknown };
  }>(
    '/api/admin/auth/fallback-policy/users/:userId',
    async (request, reply) => {
      const authResult = await requireAdmin(request, options.config);
      if (!authResult.ok) {
        return reply.status(authResult.statusCode).send(authResult.payload);
      }

      const userId = (request.params.userId || '').trim();
      if (!userId) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            code: 'USER_ID_REQUIRED',
            userMessage: 'userId is required',
          })
        );
      }

      if (typeof request.body?.localLoginEnabled !== 'boolean') {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            code: 'LOCAL_LOGIN_ENABLED_INVALID',
            userMessage: 'localLoginEnabled must be a boolean',
          })
        );
      }

      try {
        const state = await setUserLocalLoginEnabledByUserId(
          userId,
          request.body.localLoginEnabled
        );
        if (!state) {
          return reply.status(404).send(
            buildRouteErrorPayload({
              request,
              statusCode: 404,
              code: 'USER_NOT_FOUND',
              userMessage: 'User not found',
            })
          );
        }

        return reply.send({
          success: true,
          data: state,
        });
      } catch (error) {
        request.log.error(
          { err: error },
          '[FastifyAPI][admin-auth-fallback-policy-user] PATCH failed'
        );
        return reply.status(500).send(
          buildRouteErrorPayload({
            request,
            statusCode: 500,
            code: 'USER_FALLBACK_STATE_UPDATE_FAILED',
            userMessage: 'Failed to update user fallback state',
            developerMessage:
              error instanceof Error
                ? error.message
                : 'Unknown user fallback state update error',
          })
        );
      }
    }
  );
};
