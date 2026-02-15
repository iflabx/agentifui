import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import {
  queryRowsWithPgSystemContext,
  queryRowsWithPgUserContext,
} from '@lib/server/pg/user-context';
import { requireAdmin } from '@lib/services/admin/require-admin';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

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

async function requireAuthenticated(request: Request) {
  const identity = await resolveSessionIdentity(request.headers);
  if (!identity.success) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Failed to verify session' },
        { status: 500 }
      ),
    };
  }

  if (!identity.data) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      ),
    };
  }

  return { ok: true as const, userId: identity.data.userId };
}

async function queryScopedAppRows(
  actorUserId: string | null,
  sql: string,
  params: unknown[] = []
): Promise<ScopedAppRow[]> {
  if (actorUserId) {
    return queryRowsWithPgUserContext<ScopedAppRow>(actorUserId, sql, params);
  }

  return queryRowsWithPgSystemContext<ScopedAppRow>(sql, params);
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = (url.searchParams.get('scope') || '').trim();
    const instanceId = (url.searchParams.get('instanceId') || '').trim();
    const mode = (url.searchParams.get('mode') || '').trim();

    const isPublicScope = scope === 'public';
    const isAllScope = scope === 'all';

    let actorUserId: string | null = null;
    if (isAllScope) {
      const admin = await requireAdmin(request.headers);
      if (!admin.ok) {
        return admin.response;
      }
      actorUserId = admin.userId;
    } else if (!isPublicScope) {
      const authResult = await requireAuthenticated(request);
      if (!authResult.ok) {
        return authResult.response;
      }
      actorUserId = authResult.userId;
    }

    if (instanceId) {
      const scopedRows = await queryScopedAppRows(
        actorUserId,
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
        return NextResponse.json(
          { success: false, error: 'App instance not found' },
          { status: 404 }
        );
      }

      const detail = await resolveDetailByServiceInstanceId(scoped.id);
      if (!detail) {
        return NextResponse.json(
          { success: false, error: 'App instance not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, app: toAppDetail(detail) });
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
        return NextResponse.json(
          { success: false, error: 'Default app instance not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, app: toAppDetail(rows[0]) });
    }

    const scopedRows = await queryScopedAppRows(
      actorUserId,
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
      return NextResponse.json({
        success: true,
        apps: [],
      });
    }

    const details = await listAppDetailsByIds(scopedRows.map(row => row.id));
    const detailById = new Map(details.map(row => [row.id, row]));
    const orderedDetails = scopedRows
      .map(row => detailById.get(row.id))
      .filter((row): row is AppRow => Boolean(row));

    return NextResponse.json({
      success: true,
      apps: orderedDetails.map(toAppListItem),
    });
  } catch (error) {
    console.error('[InternalAppsAPI] failed:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin(request.headers);
    if (!admin.ok) {
      return admin.response;
    }

    const body = (await request.json()) as {
      id?: string;
      visibility?: 'public' | 'group_only' | 'private';
    };
    const id = (body.id || '').trim();
    const visibility = body.visibility;
    if (
      !id ||
      (visibility !== 'public' &&
        visibility !== 'group_only' &&
        visibility !== 'private')
    ) {
      return NextResponse.json(
        { success: false, error: 'Invalid update payload' },
        { status: 400 }
      );
    }

    const rows = await queryRowsWithPgUserContext<AppRow>(
      admin.userId,
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
      return NextResponse.json(
        { success: false, error: 'App instance not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      app: toAppDetail(rows[0]),
    });
  } catch (error) {
    console.error('[InternalAppsAPI] PATCH failed:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
