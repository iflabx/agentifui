import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import {
  queryRowsWithPgSystemContext,
  queryRowsWithPgUserContext,
} from '../lib/pg-context';
import {
  type ActorIdentity,
  resolveIdentityFromUpstream,
} from '../lib/upstream-session';

interface InternalAppsRoutesOptions {
  config: ApiRuntimeConfig;
}

interface ScopedAppRow {
  id: string;
  provider_id: string;
  display_name: string | null;
  description: string | null;
  instance_id: string;
  api_path: string;
  is_default: boolean;
  visibility: string;
  config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface AppRow extends ScopedAppRow {
  provider_name: string;
  provider_is_active: boolean;
  provider_is_default: boolean;
}

function readQueryValue(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function toAppDetail(row: AppRow) {
  return {
    id: row.id,
    provider_id: row.provider_id,
    display_name: row.display_name,
    description: row.description,
    instance_id: row.instance_id,
    api_path: row.api_path,
    is_default: row.is_default,
    visibility: row.visibility,
    config: row.config || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    provider_name: row.provider_name,
    provider: {
      id: row.provider_id,
      name: row.provider_name,
      is_active: row.provider_is_active,
      is_default: row.provider_is_default,
    },
  };
}

function toAppListItem(row: AppRow) {
  return {
    id: row.id,
    name: row.display_name || row.instance_id,
    instance_id: row.instance_id,
    display_name: row.display_name || undefined,
    description: row.description || undefined,
    config: row.config || {},
    visibility: row.visibility || 'public',
  };
}

async function queryScopedAppRows(
  actor: ActorIdentity | null,
  sql: string,
  params: unknown[] = []
): Promise<ScopedAppRow[]> {
  if (!actor) {
    return queryRowsWithPgSystemContext<ScopedAppRow>(sql, params);
  }
  return queryRowsWithPgUserContext<ScopedAppRow>(
    actor.userId,
    actor.role,
    sql,
    params
  );
}

async function querySystemAppRows(
  sql: string,
  params: unknown[] = []
): Promise<AppRow[]> {
  return queryRowsWithPgSystemContext<AppRow>(sql, params);
}

async function listAppDetailsByIds(ids: string[]): Promise<AppRow[]> {
  if (ids.length === 0) {
    return [];
  }

  return querySystemAppRows(
    `
      SELECT
        si.id::text,
        si.provider_id::text,
        si.display_name,
        si.description,
        si.instance_id,
        si.api_path,
        si.is_default,
        si.visibility,
        si.config,
        si.created_at::text,
        si.updated_at::text,
        p.name AS provider_name,
        p.is_active AS provider_is_active,
        p.is_default AS provider_is_default
      FROM service_instances si
      INNER JOIN providers p ON p.id = si.provider_id
      WHERE si.id = ANY($1::uuid[])
        AND p.is_active = TRUE
      ORDER BY si.display_name ASC NULLS LAST, si.instance_id ASC
    `,
    [ids]
  );
}

async function resolveDetailByServiceInstanceId(
  serviceInstanceId: string
): Promise<AppRow | null> {
  const rows = await querySystemAppRows(
    `
      SELECT
        si.id::text,
        si.provider_id::text,
        si.display_name,
        si.description,
        si.instance_id,
        si.api_path,
        si.is_default,
        si.visibility,
        si.config,
        si.created_at::text,
        si.updated_at::text,
        p.name AS provider_name,
        p.is_active AS provider_is_active,
        p.is_default AS provider_is_default
      FROM service_instances si
      INNER JOIN providers p ON p.id = si.provider_id
      WHERE si.id = $1::uuid
        AND p.is_active = TRUE
      LIMIT 1
    `,
    [serviceInstanceId]
  );
  return rows[0] || null;
}

async function requireAdminActor(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<
  | { ok: true; actor: ActorIdentity }
  | { ok: false; statusCode: number; payload: Record<string, string> }
> {
  const resolved = await resolveIdentityFromUpstream(request, config);
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
  return {
    ok: true,
    actor: resolved.identity,
  };
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

export const internalAppsRoutes: FastifyPluginAsync<
  InternalAppsRoutesOptions
> = async (app, options) => {
  app.get<{
    Querystring: { scope?: string; instanceId?: string; mode?: string };
  }>('/api/internal/apps', async (request, reply) => {
    try {
      const scope = readQueryValue(request.query.scope);
      const instanceId = readQueryValue(request.query.instanceId);
      const mode = readQueryValue(request.query.mode);
      const isPublicScope = scope === 'public';
      const isAllScope = scope === 'all';

      let actor: ActorIdentity | null = null;
      if (isAllScope) {
        const adminResult = await requireAdminActor(request, options.config);
        if (!adminResult.ok) {
          return reply.status(adminResult.statusCode).send(adminResult.payload);
        }
        actor = adminResult.actor;
      } else if (!isPublicScope) {
        const actorResult = await requireActor(request, options.config);
        if (!actorResult.ok) {
          return reply.status(actorResult.statusCode).send(actorResult.payload);
        }
        actor = actorResult.actor;
      }

      if (instanceId) {
        const scopedRows = await queryScopedAppRows(
          actor,
          `
              SELECT
                si.id::text,
                si.provider_id::text,
                si.display_name,
                si.description,
                si.instance_id,
                si.api_path,
                si.is_default,
                si.visibility,
                si.config,
                si.created_at::text,
                si.updated_at::text
              FROM service_instances si
              WHERE si.instance_id = $1
                ${isPublicScope ? "AND si.visibility = 'public'" : ''}
              LIMIT 1
            `,
          [instanceId]
        );

        const scoped = scopedRows[0];
        if (!scoped) {
          return reply
            .status(404)
            .send({ success: false, error: 'App instance not found' });
        }

        const detail = await resolveDetailByServiceInstanceId(scoped.id);
        if (!detail) {
          return reply
            .status(404)
            .send({ success: false, error: 'App instance not found' });
        }

        return reply.send({ success: true, app: toAppDetail(detail) });
      }

      if (mode === 'default') {
        const rows = await querySystemAppRows(
          `
              SELECT
                si.id::text,
                si.provider_id::text,
                si.display_name,
                si.description,
                si.instance_id,
                si.api_path,
                si.is_default,
                si.visibility,
                si.config,
                si.created_at::text,
                si.updated_at::text,
                p.name AS provider_name,
                p.is_active AS provider_is_active,
                p.is_default AS provider_is_default
              FROM service_instances si
              INNER JOIN providers p ON p.id = si.provider_id
              WHERE p.is_active = TRUE
                AND p.is_default = TRUE
                AND si.is_default = TRUE
              LIMIT 1
            `
        );

        if (!rows[0]) {
          return reply.send({
            success: true,
            app: null,
            defaultMissing: true,
          });
        }
        return reply.send({ success: true, app: toAppDetail(rows[0]) });
      }

      const scopedRows = await queryScopedAppRows(
        actor,
        `
            SELECT
              si.id::text,
              si.provider_id::text,
              si.display_name,
              si.description,
              si.instance_id,
              si.api_path,
              si.is_default,
              si.visibility,
              si.config,
              si.created_at::text,
              si.updated_at::text
            FROM service_instances si
            WHERE TRUE
              ${isPublicScope ? "AND si.visibility = 'public'" : ''}
            ORDER BY si.display_name ASC NULLS LAST, si.instance_id ASC
          `
      );

      if (scopedRows.length === 0) {
        return reply.send({
          success: true,
          apps: [],
        });
      }

      const details = await listAppDetailsByIds(scopedRows.map(row => row.id));
      const detailById = new Map(details.map(row => [row.id, row]));
      const orderedDetails = scopedRows
        .map(row => detailById.get(row.id))
        .filter((row): row is AppRow => Boolean(row));

      return reply.send({
        success: true,
        apps: orderedDetails.map(toAppListItem),
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][internal-apps] GET failed'
      );
      return reply
        .status(500)
        .send({ success: false, error: 'Internal server error' });
    }
  });

  app.patch<{
    Body: {
      id?: string;
      visibility?: 'public' | 'group_only' | 'private';
    };
  }>('/api/internal/apps', async (request, reply) => {
    try {
      const admin = await requireAdminActor(request, options.config);
      if (!admin.ok) {
        return reply.status(admin.statusCode).send(admin.payload);
      }

      const id = readQueryValue(request.body?.id);
      const visibility = request.body?.visibility;
      if (
        !id ||
        (visibility !== 'public' &&
          visibility !== 'group_only' &&
          visibility !== 'private')
      ) {
        return reply
          .status(400)
          .send({ success: false, error: 'Invalid update payload' });
      }

      const rows = await queryRowsWithPgUserContext<AppRow>(
        admin.actor.userId,
        admin.actor.role,
        `
          UPDATE service_instances si
          SET visibility = $1,
              updated_at = NOW()
          FROM providers p
          WHERE si.id = $2::uuid
            AND p.id = si.provider_id
          RETURNING
            si.id::text,
            si.provider_id::text,
            si.display_name,
            si.description,
            si.instance_id,
            si.api_path,
            si.is_default,
            si.visibility,
            si.config,
            si.created_at::text,
            si.updated_at::text,
            p.name AS provider_name,
            p.is_active AS provider_is_active,
            p.is_default AS provider_is_default
        `,
        [visibility, id]
      );

      if (!rows[0]) {
        return reply
          .status(404)
          .send({ success: false, error: 'App instance not found' });
      }

      return reply.send({
        success: true,
        app: toAppDetail(rows[0]),
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][internal-apps] PATCH failed'
      );
      return reply
        .status(500)
        .send({ success: false, error: 'Internal server error' });
    }
  });
};
