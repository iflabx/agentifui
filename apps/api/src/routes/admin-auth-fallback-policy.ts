import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { resolveIdentityFromSession } from '../lib/upstream-session';

type AuthMode = 'normal' | 'degraded';

interface AdminAuthFallbackPolicyRoutesOptions {
  config: ApiRuntimeConfig;
}

interface AuthModeRow {
  auth_mode: string | null;
}

function normalizeAuthMode(input: string | null | undefined): AuthMode {
  if (input === 'degraded') {
    return 'degraded';
  }
  return 'normal';
}

function parseAuthMode(input: unknown): AuthMode | null {
  if (typeof input !== 'string') {
    return null;
  }

  const normalized = input.trim().toLowerCase();
  if (normalized === 'normal' || normalized === 'degraded') {
    return normalized;
  }
  return null;
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

async function setAuthModeSetting(authMode: AuthMode): Promise<AuthMode> {
  const updatedRows = await queryRowsWithPgSystemContext<AuthModeRow>(
    `
      WITH target AS (
        SELECT id
        FROM auth_settings
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 1
      )
      UPDATE auth_settings
      SET auth_mode = $1, updated_at = NOW()
      WHERE id = (SELECT id FROM target)
      RETURNING auth_mode
    `,
    [authMode]
  );

  if (updatedRows[0]) {
    return normalizeAuthMode(updatedRows[0].auth_mode);
  }

  const insertedRows = await queryRowsWithPgSystemContext<AuthModeRow>(
    `
      INSERT INTO auth_settings (auth_mode, created_at, updated_at)
      VALUES ($1, NOW(), NOW())
      RETURNING auth_mode
    `,
    [authMode]
  );
  return normalizeAuthMode(insertedRows[0]?.auth_mode);
}

export const adminAuthFallbackPolicyRoutes: FastifyPluginAsync<
  AdminAuthFallbackPolicyRoutesOptions
> = async (app, options) => {
  app.get('/api/admin/auth/fallback-policy', async (request, reply) => {
    const authResult = await requireAdmin(request, options.config);
    if (!authResult.ok) {
      return reply.status(authResult.statusCode).send(authResult.payload);
    }

    try {
      const authMode = await getAuthModeSetting();
      return reply.send({
        success: true,
        authMode,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][admin-auth-fallback-policy] GET failed'
      );
      return reply.status(500).send({ error: 'Failed to read auth mode' });
    }
  });

  app.patch<{
    Body: { authMode?: unknown };
  }>('/api/admin/auth/fallback-policy', async (request, reply) => {
    const authResult = await requireAdmin(request, options.config);
    if (!authResult.ok) {
      return reply.status(authResult.statusCode).send(authResult.payload);
    }

    const authMode = parseAuthMode(request.body?.authMode);
    if (!authMode) {
      return reply
        .status(400)
        .send({ error: 'authMode must be "normal" or "degraded"' });
    }

    try {
      const updated = await setAuthModeSetting(authMode);
      return reply.send({
        success: true,
        authMode: updated,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][admin-auth-fallback-policy] PATCH failed'
      );
      return reply.status(500).send({ error: 'Failed to update auth mode' });
    }
  });
};
