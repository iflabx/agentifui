import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import {
  type ProfileStatusIdentity,
  resolveProfileStatusFromUpstream,
} from '../lib/upstream-session';

type AuthMode = 'normal' | 'degraded';

interface InternalAuthLocalPasswordRoutesOptions {
  config: ApiRuntimeConfig;
}

interface AuthModeRow {
  auth_mode: string | null;
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

interface CredentialPasswordExistsRow {
  has_credential_password: boolean | null;
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

function normalizeAuthMode(input: string | null | undefined): AuthMode {
  if (input === 'degraded') {
    return 'degraded';
  }
  return 'normal';
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

async function resolveIdentity(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<
  | { ok: true; identity: ProfileStatusIdentity }
  | { ok: false; statusCode: number; payload: Record<string, string> }
> {
  const resolved = await resolveProfileStatusFromUpstream(request, config);
  if (resolved.kind === 'unauthorized') {
    return {
      ok: false,
      statusCode: 401,
      payload: { error: 'Unauthorized' },
    };
  }
  if (resolved.kind === 'error') {
    return {
      ok: false,
      statusCode: 500,
      payload: { error: 'Failed to verify session' },
    };
  }
  return { ok: true, identity: resolved.identity };
}

async function getAuthModeSetting(): Promise<AuthMode> {
  const rows = await queryRowsWithPgSystemContext<AuthModeRow>(
    `
      SELECT auth_mode
      FROM auth_settings
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 1
    `
  );
  return normalizeAuthMode(rows[0]?.auth_mode);
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

async function hasCredentialPasswordByAuthUserId(
  authUserId: string
): Promise<boolean> {
  const rows = await queryRowsWithPgSystemContext<CredentialPasswordExistsRow>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM auth_accounts
        WHERE user_id = $1::uuid
          AND provider_id = 'credential'
          AND password IS NOT NULL
      ) AS has_credential_password
    `,
    [authUserId]
  );

  return Boolean(rows[0]?.has_credential_password);
}

export const internalAuthLocalPasswordRoutes: FastifyPluginAsync<
  InternalAuthLocalPasswordRoutesOptions
> = async (app, options) => {
  app.get('/api/internal/auth/local-password', async (request, reply) => {
    const auth = await resolveIdentity(request, options.config);
    if (!auth.ok) {
      return reply.status(auth.statusCode).send(auth.payload);
    }

    try {
      const [authMode, localState, hasFallbackPassword] = await Promise.all([
        getAuthModeSetting(),
        getUserLocalLoginStateByUserId(auth.identity.userId),
        hasCredentialPasswordByAuthUserId(auth.identity.authUserId),
      ]);

      if (!localState) {
        return reply.status(404).send({ error: 'Profile not found' });
      }

      return reply.send({
        success: true,
        data: {
          userId: localState.userId,
          authUserId: auth.identity.authUserId,
          authSource: localState.authSource,
          authMode,
          localLoginEnabled: localState.localLoginEnabled,
          localLoginUpdatedAt: localState.localLoginUpdatedAt,
          hasFallbackPassword,
          fallbackPasswordSetAt: localState.fallbackPasswordSetAt,
          fallbackPasswordUpdatedBy: localState.fallbackPasswordUpdatedBy,
          localLoginAllowedNow:
            authMode === 'degraded' &&
            localState.localLoginEnabled &&
            hasFallbackPassword,
        },
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][internal-auth-local-password] GET failed'
      );
      return reply
        .status(500)
        .send({ error: 'Failed to read local password state' });
    }
  });
};
