import type { PoolClient, QueryResultRow } from 'pg';

import { getPgPool } from './pool';

export interface PgRlsContextInput {
  userId?: string | null;
  role?: string | null;
  systemActor?: boolean;
}

function normalizeUserId(userId: string | null | undefined): string {
  if (typeof userId !== 'string') {
    return '';
  }

  const normalized = userId.trim();
  return normalized.length > 0 ? normalized : '';
}

function normalizeRole(role: string | null | undefined): string {
  if (typeof role !== 'string') {
    return '';
  }

  const normalized = role.trim();
  return normalized.length > 0 ? normalized : '';
}

function normalizeSystemActor(systemActor: boolean | null | undefined): string {
  return systemActor ? 'true' : 'false';
}

async function resolveActorRole(
  client: PoolClient,
  context: PgRlsContextInput
): Promise<string> {
  const providedRole = normalizeRole(context.role);
  if (providedRole) {
    return providedRole;
  }

  const userId = normalizeUserId(context.userId);
  if (!userId) {
    return '';
  }

  const roleResult = await client.query<{ role: string }>(
    `
      SELECT COALESCE(role::text, 'user') AS role
      FROM profiles
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [userId]
  );

  return normalizeRole(roleResult.rows[0]?.role);
}

export async function runWithPgRlsContext<T>(
  context: PgRlsContextInput,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPgPool();
  const client = await pool.connect();

  const normalizedUserId = normalizeUserId(context.userId);
  const normalizedSystemActor = normalizeSystemActor(context.systemActor);

  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_user_id', $1::text, true)`,
      [normalizedUserId]
    );
    await client.query(
      `SELECT set_config('app.current_user_role', $1::text, true)`,
      ['']
    );
    await client.query(
      `SELECT set_config('app.rls_system_actor', $1::text, true)`,
      [normalizedSystemActor]
    );

    const resolvedRole = await resolveActorRole(client, context);
    await client.query(
      `SELECT set_config('app.current_user_role', $1::text, true)`,
      [resolvedRole]
    );

    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function runWithPgUserContext<T>(
  userId: string | null | undefined,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  return runWithPgRlsContext({ userId }, operation);
}

export async function runWithPgSystemContext<T>(
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  return runWithPgRlsContext({ systemActor: true }, operation);
}

export async function queryRowsWithPgRlsContext<
  T extends QueryResultRow = QueryResultRow,
>(
  context: PgRlsContextInput,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return runWithPgRlsContext(context, async client => {
    const { rows } = await client.query<T>(sql, params);
    return rows;
  });
}

export async function queryRowsWithPgUserContext<
  T extends QueryResultRow = QueryResultRow,
>(
  userId: string | null | undefined,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return queryRowsWithPgRlsContext<T>({ userId }, sql, params);
}

export async function queryRowsWithPgSystemContext<
  T extends QueryResultRow = QueryResultRow,
>(sql: string, params: unknown[] = []): Promise<T[]> {
  return queryRowsWithPgRlsContext<T>({ systemActor: true }, sql, params);
}
