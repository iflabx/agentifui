import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import {
  type ActorIdentity,
  resolveIdentityFromUpstream,
} from '../lib/upstream-session';

interface InternalProfileRoutesOptions {
  config: ApiRuntimeConfig;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  role: string | null;
  status: string | null;
  auth_source: string | null;
  sso_provider_id: string | null;
  employee_number: string | null;
  email: string | null;
  phone: string | null;
  department: string | null;
  job_title: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_login: string | null;
}

const PROFILE_SELECT_SQL = `
  SELECT
    p.id::text,
    p.full_name,
    p.username,
    p.avatar_url,
    p.role::text,
    p.status::text,
    p.auth_source,
    p.sso_provider_id::text,
    p.employee_number,
    p.email,
    p.phone,
    pea.department_name AS department,
    pea.job_title,
    p.created_at::text,
    p.updated_at::text,
    p.last_login::text
  FROM profiles p
  LEFT JOIN profile_external_attributes pea
    ON pea.user_id = p.id
`;

function resolveTargetUserId(
  queryUserId: unknown,
  currentUserId: string
): string {
  if (typeof queryUserId !== 'string') {
    return currentUserId;
  }
  const normalized = queryUserId.trim();
  return normalized.length > 0 ? normalized : currentUserId;
}

function canAccessTargetUser(
  targetUserId: string,
  currentUserId: string,
  currentRole: string
): boolean {
  return targetUserId === currentUserId || currentRole === 'admin';
}

async function requireActor(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<
  | { ok: true; actor: ActorIdentity }
  | { ok: false; statusCode: number; payload: Record<string, string | boolean> }
> {
  const resolved = await resolveIdentityFromUpstream(request, config);
  if (resolved.kind === 'unauthorized') {
    return {
      ok: false,
      statusCode: 401,
      payload: { success: false, error: 'Unauthorized' },
    };
  }
  if (resolved.kind === 'error') {
    return {
      ok: false,
      statusCode: 500,
      payload: { success: false, error: 'Failed to verify session' },
    };
  }
  return {
    ok: true,
    actor: resolved.identity,
  };
}

export const internalProfileRoutes: FastifyPluginAsync<
  InternalProfileRoutesOptions
> = async (app, options) => {
  app.get<{
    Querystring: { userId?: string };
  }>('/api/internal/profile', async (request, reply) => {
    try {
      const auth = await requireActor(request, options.config);
      if (!auth.ok) {
        return reply.status(auth.statusCode).send(auth.payload);
      }

      const targetUserId = resolveTargetUserId(
        request.query.userId,
        auth.actor.userId
      );

      if (
        !canAccessTargetUser(targetUserId, auth.actor.userId, auth.actor.role)
      ) {
        return reply.status(403).send({ success: false, error: 'Forbidden' });
      }

      const rows = await queryRowsWithPgSystemContext<ProfileRow>(
        `${PROFILE_SELECT_SQL} WHERE p.id = $1::uuid LIMIT 1`,
        [targetUserId]
      );

      return reply.send({
        success: true,
        profile: rows[0] || null,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][internal-profile] GET failed'
      );
      return reply
        .status(500)
        .send({ success: false, error: 'Internal server error' });
    }
  });

  app.patch<{
    Body: {
      userId?: string;
      updates?: Record<string, unknown>;
    };
  }>('/api/internal/profile', async (request, reply) => {
    try {
      const auth = await requireActor(request, options.config);
      if (!auth.ok) {
        return reply.status(auth.statusCode).send(auth.payload);
      }

      const targetUserId = resolveTargetUserId(
        request.body?.userId,
        auth.actor.userId
      );

      if (
        !canAccessTargetUser(targetUserId, auth.actor.userId, auth.actor.role)
      ) {
        return reply.status(403).send({ success: false, error: 'Forbidden' });
      }

      const updates = request.body?.updates || {};
      const allowedColumns = new Set(['full_name', 'username', 'avatar_url']);
      const entries = Object.entries(updates).filter(
        ([key, value]) => allowedColumns.has(key) && value !== undefined
      );

      if (entries.length === 0) {
        return reply
          .status(400)
          .send({ success: false, error: 'No valid fields to update' });
      }

      const setClauses = entries.map(
        ([column], index) => `${column} = $${index + 1}`
      );
      const values = entries.map(([, value]) => value);
      values.push(new Date().toISOString());
      setClauses.push(`updated_at = $${values.length}`);
      values.push(targetUserId);

      const oldProfileRows = await queryRowsWithPgSystemContext<ProfileRow>(
        `${PROFILE_SELECT_SQL} WHERE p.id = $1::uuid LIMIT 1`,
        [targetUserId]
      );

      const updateRows = await queryRowsWithPgSystemContext<{ id: string }>(
        `
          UPDATE profiles
          SET ${setClauses.join(', ')}
          WHERE id = $${values.length}::uuid
          RETURNING id::text
        `,
        values
      );

      if (!updateRows[0]) {
        return reply
          .status(404)
          .send({ success: false, error: 'Profile not found' });
      }

      const profileRows = await queryRowsWithPgSystemContext<ProfileRow>(
        `${PROFILE_SELECT_SQL} WHERE p.id = $1::uuid LIMIT 1`,
        [targetUserId]
      );

      return reply.send({
        success: true,
        profile: profileRows[0] || oldProfileRows[0] || null,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][internal-profile] PATCH failed'
      );
      return reply
        .status(500)
        .send({ success: false, error: 'Internal server error' });
    }
  });
};
