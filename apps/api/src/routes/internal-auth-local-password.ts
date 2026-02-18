import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import {
  type ProfileStatusIdentity,
  resolveProfileStatusFromSession,
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

interface PasswordChangePayload {
  currentPassword?: unknown;
  newPassword?: unknown;
  revokeOtherSessions?: unknown;
}

interface PasswordBootstrapPayload {
  newPassword?: unknown;
}

interface UpstreamPasswordResponse {
  ok: boolean;
  statusCode: number;
  message?: string;
  token?: string | null;
}

const FASTIFY_BYPASS_HEADER = 'x-agentifui-fastify-bypass';
const INTERNAL_AUTH_PROXY_HEADER = 'x-agentifui-internal-auth-proxy';
const FORWARDED_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'user-agent',
] as const;

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

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveBetterAuthOrigin(): string {
  const configured =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    null;
  if (configured) {
    return new URL(configured).origin;
  }

  return 'http://localhost:3000';
}

function buildUpstreamHeaders(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Headers {
  const headers = new Headers();
  for (const key of FORWARDED_HEADERS) {
    const value = request.headers[key];
    if (typeof value === 'string' && value.length > 0) {
      headers.set(key, value);
    }
  }
  const betterAuthOrigin = resolveBetterAuthOrigin();
  headers.set('origin', betterAuthOrigin);
  headers.set('referer', `${betterAuthOrigin}/`);
  headers.set(FASTIFY_BYPASS_HEADER, '1');
  headers.set(INTERNAL_AUTH_PROXY_HEADER, '1');
  headers.set('content-type', 'application/json');
  return headers;
}

async function parseJsonBody<TPayload extends object>(
  request: FastifyRequest
): Promise<
  | { ok: true; payload: TPayload }
  | { ok: false; statusCode: number; payload: Record<string, string> }
> {
  if (request.body == null) {
    return { ok: true, payload: {} as TPayload };
  }

  if (typeof request.body === 'object' && !Array.isArray(request.body)) {
    return { ok: true, payload: request.body as TPayload };
  }

  if (typeof request.body === 'string') {
    try {
      const parsed = JSON.parse(request.body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ok: true, payload: parsed as TPayload };
      }
      return {
        ok: false,
        statusCode: 400,
        payload: { error: 'Invalid JSON body' },
      };
    } catch {
      return {
        ok: false,
        statusCode: 400,
        payload: { error: 'Invalid JSON body' },
      };
    }
  }

  return {
    ok: false,
    statusCode: 400,
    payload: { error: 'Invalid JSON body' },
  };
}

function extractUpstreamErrorMessage(
  payload: Record<string, unknown> | null
): string | null {
  if (!payload) {
    return null;
  }

  const message = parseNonEmptyString(payload.message);
  if (message) {
    return message;
  }

  const error = payload.error;
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }

  if (error && typeof error === 'object') {
    const nestedMessage = parseNonEmptyString(
      (error as Record<string, unknown>).message
    );
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  return parseNonEmptyString(payload.code);
}

async function callUpstreamPasswordEndpoint(
  request: FastifyRequest,
  config: ApiRuntimeConfig,
  path: '/api/auth/better/set-password' | '/api/auth/better/change-password',
  body: Record<string, unknown>,
  defaultErrorMessage: string
): Promise<UpstreamPasswordResponse> {
  async function postJson(targetPath: string): Promise<{
    response: Response;
    payload: Record<string, unknown> | null;
  }> {
    const url = new URL(targetPath, config.nextUpstreamBaseUrl).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: buildUpstreamHeaders(request, config),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      let payload: Record<string, unknown> | null = null;
      try {
        const parsed = (await response.json()) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        }
      } catch {
        payload = null;
      }
      return { response, payload };
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    const primary = await postJson(path);

    if (!primary.response.ok) {
      return {
        ok: false,
        statusCode:
          primary.response.status >= 400 && primary.response.status <= 599
            ? primary.response.status
            : 500,
        message:
          extractUpstreamErrorMessage(primary.payload) || defaultErrorMessage,
      };
    }

    return {
      ok: true,
      statusCode: 200,
      token: parseNonEmptyString(primary.payload?.token) ?? null,
    };
  } catch {
    return {
      ok: false,
      statusCode: 500,
      message: defaultErrorMessage,
    };
  }
}

async function markFallbackPasswordUpdated(
  userId: string,
  updatedByUserId: string
): Promise<void> {
  await queryRowsWithPgSystemContext(
    `
      UPDATE profiles
      SET
        fallback_password_set_at = NOW(),
        fallback_password_updated_by = $2::uuid,
        updated_at = NOW()
      WHERE id = $1::uuid
    `,
    [userId, updatedByUserId]
  );
}

async function resolveIdentity(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<
  | { ok: true; identity: ProfileStatusIdentity }
  | { ok: false; statusCode: number; payload: Record<string, string> }
> {
  const resolved = await resolveProfileStatusFromSession(request, config);
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

  app.post(
    '/api/internal/auth/local-password/bootstrap',
    async (request, reply) => {
      const auth = await resolveIdentity(request, options.config);
      if (!auth.ok) {
        return reply.status(auth.statusCode).send(auth.payload);
      }

      const parsedBody = await parseJsonBody<PasswordBootstrapPayload>(request);
      if (!parsedBody.ok) {
        return reply.status(parsedBody.statusCode).send(parsedBody.payload);
      }

      const newPassword = parseNonEmptyString(parsedBody.payload.newPassword);
      if (!newPassword) {
        return reply.status(400).send({ error: 'newPassword is required' });
      }

      try {
        const hasPassword = await hasCredentialPasswordByAuthUserId(
          auth.identity.authUserId
        );
        if (hasPassword) {
          return reply
            .status(409)
            .send({ error: 'Fallback password already set' });
        }

        const passwordResult = await callUpstreamPasswordEndpoint(
          request,
          options.config,
          '/api/auth/better/set-password',
          { newPassword },
          'Failed to set fallback password'
        );
        if (!passwordResult.ok) {
          return reply
            .status(passwordResult.statusCode)
            .send({ error: passwordResult.message });
        }

        await markFallbackPasswordUpdated(
          auth.identity.userId,
          auth.identity.userId
        );

        return reply.send({
          success: true,
          message: 'Fallback password set',
        });
      } catch (error) {
        request.log.error(
          { err: error },
          '[FastifyAPI][internal-auth-local-password] POST bootstrap failed'
        );
        return reply
          .status(500)
          .send({ error: 'Failed to detect fallback password state' });
      }
    }
  );

  app.post(
    '/api/internal/auth/local-password/change',
    async (request, reply) => {
      const auth = await resolveIdentity(request, options.config);
      if (!auth.ok) {
        return reply.status(auth.statusCode).send(auth.payload);
      }

      const parsedBody = await parseJsonBody<PasswordChangePayload>(request);
      if (!parsedBody.ok) {
        return reply.status(parsedBody.statusCode).send(parsedBody.payload);
      }

      const currentPassword = parseNonEmptyString(
        parsedBody.payload.currentPassword
      );
      const newPassword = parseNonEmptyString(parsedBody.payload.newPassword);
      if (!currentPassword || !newPassword) {
        return reply.status(400).send({
          error: 'currentPassword and newPassword are required',
        });
      }

      try {
        const hasPassword = await hasCredentialPasswordByAuthUserId(
          auth.identity.authUserId
        );
        if (!hasPassword) {
          return reply
            .status(409)
            .send({ error: 'Fallback password is not set' });
        }

        const passwordResult = await callUpstreamPasswordEndpoint(
          request,
          options.config,
          '/api/auth/better/change-password',
          {
            currentPassword,
            newPassword,
            revokeOtherSessions:
              typeof parsedBody.payload.revokeOtherSessions === 'boolean'
                ? parsedBody.payload.revokeOtherSessions
                : undefined,
          },
          'Failed to change fallback password'
        );
        if (!passwordResult.ok) {
          return reply
            .status(passwordResult.statusCode)
            .send({ error: passwordResult.message });
        }

        await markFallbackPasswordUpdated(
          auth.identity.userId,
          auth.identity.userId
        );

        return reply.send({
          success: true,
          message: 'Fallback password changed',
          token: passwordResult.token ?? null,
        });
      } catch (error) {
        request.log.error(
          { err: error },
          '[FastifyAPI][internal-auth-local-password] POST change failed'
        );
        return reply
          .status(500)
          .send({ error: 'Failed to detect fallback password state' });
      }
    }
  );
};
