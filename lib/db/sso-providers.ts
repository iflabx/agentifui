/**
 * SSO providers database operations.
 * Uses PostgreSQL directly on server and internal API bridge on browser.
 */
import {
  CreateSsoProviderData,
  SsoProtocol,
  SsoProvider,
} from '@lib/types/database';
import { Result, failure, success } from '@lib/types/result';

import { callInternalDataAction } from './internal-data-api';

const IS_BROWSER = typeof window !== 'undefined';

async function getPool() {
  const { getPgPool } = await import('@lib/server/pg/pool');
  return getPgPool();
}

export interface SsoProviderFilters {
  protocol?: SsoProtocol;
  enabled?: boolean;
  search?: string;
  sortBy?: 'name' | 'protocol' | 'created_at' | 'display_order';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface SsoProviderStats {
  total: number;
  enabled: number;
  disabled: number;
  byProtocol: Record<SsoProtocol, number>;
}

export interface UpdateSsoProviderData {
  name?: string;
  protocol?: SsoProtocol;
  settings?: SsoProvider['settings'];
  client_id?: string | null;
  client_secret?: string | null;
  metadata_url?: string | null;
  enabled?: boolean;
  display_order?: number;
  button_text?: string | null;
}

const SSO_SORT_COLUMN_MAP: Record<
  NonNullable<SsoProviderFilters['sortBy']>,
  string
> = {
  name: 'name',
  protocol: 'protocol',
  created_at: 'created_at',
  display_order: 'display_order',
};

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

function buildSsoWhereClause(filters: SsoProviderFilters): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.protocol) {
    params.push(filters.protocol);
    clauses.push(`protocol = $${params.length}::sso_protocol`);
  }

  if (filters.enabled !== undefined) {
    params.push(filters.enabled);
    clauses.push(`enabled = $${params.length}`);
  }

  if (filters.search?.trim()) {
    params.push(`%${escapeLikePattern(filters.search.trim())}%`);
    clauses.push(
      `(name ILIKE $${params.length} ESCAPE '\\' OR button_text ILIKE $${params.length} ESCAPE '\\')`
    );
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

/**
 * Fetch SSO providers list with filtering and pagination.
 */
export async function getSsoProviders(
  filters: SsoProviderFilters = {}
): Promise<
  Result<{
    providers: SsoProvider[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }>
> {
  if (IS_BROWSER) {
    return callInternalDataAction('sso.getSsoProviders', { filters });
  }

  try {
    const page = Number(filters.page || 1);
    const pageSize = Number(filters.pageSize || 20);
    const sortBy = filters.sortBy || 'display_order';
    const sortOrder = filters.sortOrder === 'desc' ? 'DESC' : 'ASC';
    const sortColumn = SSO_SORT_COLUMN_MAP[sortBy] || 'display_order';
    const where = buildSsoWhereClause(filters);

    const pool = await getPool();
    const countResult = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM sso_providers ${where.sql}`,
      where.params
    );
    const total = Number(countResult.rows[0]?.total || 0);

    const limitParamIndex = where.params.length + 1;
    const offsetParamIndex = where.params.length + 2;
    const offset = Math.max(0, (page - 1) * pageSize);
    const providerResult = await pool.query<SsoProvider>(
      `
        SELECT *
        FROM sso_providers
        ${where.sql}
        ORDER BY ${sortColumn} ${sortOrder}, id ASC
        LIMIT $${limitParamIndex}
        OFFSET $${offsetParamIndex}
      `,
      [...where.params, pageSize, offset]
    );

    return success({
      providers: providerResult.rows || [],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Get SSO provider statistics for admin dashboard.
 */
export async function getSsoProviderStats(): Promise<Result<SsoProviderStats>> {
  if (IS_BROWSER) {
    return callInternalDataAction('sso.getSsoProviderStats');
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<{
      protocol: SsoProtocol;
      enabled: boolean;
    }>(`SELECT protocol, enabled FROM sso_providers`);

    const stats: SsoProviderStats = {
      total: rows.length,
      enabled: rows.filter(row => row.enabled).length,
      disabled: rows.filter(row => !row.enabled).length,
      byProtocol: {
        CAS: 0,
        SAML: 0,
        OAuth2: 0,
        OIDC: 0,
      },
    };

    rows.forEach(row => {
      stats.byProtocol[row.protocol] += 1;
    });

    return success(stats);
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Get single SSO provider by ID.
 */
export async function getSsoProviderById(
  id: string
): Promise<Result<SsoProvider | null>> {
  if (IS_BROWSER) {
    return callInternalDataAction('sso.getSsoProviderById', { id });
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<SsoProvider>(
      `SELECT * FROM sso_providers WHERE id = $1::uuid LIMIT 1`,
      [id]
    );
    return success(rows[0] || null);
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Create new SSO provider.
 */
export async function createSsoProvider(
  data: CreateSsoProviderData
): Promise<Result<SsoProvider>> {
  if (IS_BROWSER) {
    return callInternalDataAction('sso.createSsoProvider', { data });
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<SsoProvider>(
      `
        INSERT INTO sso_providers (
          name,
          protocol,
          settings,
          client_id,
          client_secret,
          metadata_url,
          enabled,
          display_order,
          button_text
        )
        VALUES (
          $1,
          $2::sso_protocol,
          $3::jsonb,
          $4,
          $5,
          $6,
          COALESCE($7, TRUE),
          COALESCE($8, 0),
          $9
        )
        RETURNING *
      `,
      [
        data.name,
        data.protocol,
        JSON.stringify(data.settings || {}),
        data.client_id || null,
        data.client_secret || null,
        data.metadata_url || null,
        data.enabled ?? true,
        data.display_order ?? 0,
        data.button_text || null,
      ]
    );

    return success(rows[0]);
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Update existing SSO provider.
 */
export async function updateSsoProvider(
  id: string,
  data: UpdateSsoProviderData
): Promise<Result<SsoProvider>> {
  if (IS_BROWSER) {
    return callInternalDataAction('sso.updateSsoProvider', { id, data });
  }

  try {
    const updates = {
      ...data,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>;
    const entries = Object.entries(updates).filter(
      ([, value]) => value !== undefined
    );
    if (entries.length === 0) {
      return failure(new Error('No fields to update'));
    }

    const setClauses = entries.map(
      ([column], index) => `${column} = $${index + 1}`
    );
    const values = entries.map(([, value]) =>
      columnNeedsJson(value) ? JSON.stringify(value) : value
    );
    values.push(id);

    const pool = await getPool();
    const { rows } = await pool.query<SsoProvider>(
      `
        UPDATE sso_providers
        SET ${setClauses.join(', ')}
        WHERE id = $${values.length}::uuid
        RETURNING *
      `,
      values
    );

    if (!rows[0]) {
      return failure(new Error('SSO provider not found'));
    }

    return success(rows[0]);
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

function columnNeedsJson(value: unknown) {
  return !!value && typeof value === 'object' && !(value instanceof Date);
}

/**
 * Delete SSO provider by ID.
 */
export async function deleteSsoProvider(id: string): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('sso.deleteSsoProvider', { id });
  }

  try {
    const pool = await getPool();
    await pool.query(`DELETE FROM sso_providers WHERE id = $1::uuid`, [id]);
    return success(undefined);
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Toggle SSO provider enabled status.
 */
export async function toggleSsoProvider(
  id: string,
  enabled: boolean
): Promise<Result<SsoProvider>> {
  if (IS_BROWSER) {
    return callInternalDataAction('sso.toggleSsoProvider', { id, enabled });
  }

  return updateSsoProvider(id, { enabled });
}

/**
 * Update display order for multiple SSO providers.
 */
export async function updateSsoProviderOrder(
  updates: Array<{ id: string; display_order: number }>
): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('sso.updateSsoProviderOrder', { updates });
  }

  try {
    if (updates.length === 0) {
      return success(undefined);
    }

    const pool = await getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const update of updates) {
        await client.query(
          `
            UPDATE sso_providers
            SET display_order = $1::integer,
                updated_at = NOW()
            WHERE id = $2::uuid
          `,
          [update.display_order, update.id]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return success(undefined);
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}
