import { Pool, type PoolClient, type QueryResultRow } from 'pg';

const PG_POOL_GLOBAL_KEY = '__agentifui_fastify_pg_pool__';

export interface PgRlsContextInput {
  userId?: string | null;
  role?: string | null;
  systemActor?: boolean;
}

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

function resolveRlsStrictModeSetting(): 'on' | 'off' | null {
  const parsed = parseBooleanEnv(process.env.APP_RLS_STRICT_MODE);
  if (parsed === null) {
    return null;
  }
  return parsed ? 'on' : 'off';
}

function resolveDatabaseUrl(): string {
  const fromPrimary = process.env.DATABASE_URL?.trim();
  if (fromPrimary) {
    return fromPrimary;
  }
  const fallback = process.env.PGURL?.trim();
  if (fallback) {
    return fallback;
  }
  throw new Error('DATABASE_URL (or PGURL) is required for Fastify API');
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

function getPgPool(): Pool {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[PG_POOL_GLOBAL_KEY] as Pool | undefined;
  if (existing) {
    return existing;
  }

  const pool = new Pool({
    connectionString: resolveDatabaseUrl(),
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_POOL_CONNECT_MS || 5000),
  });

  globalState[PG_POOL_GLOBAL_KEY] = pool;
  return pool;
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
  const strictMode = resolveRlsStrictModeSetting();

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
    if (strictMode) {
      await client.query(
        `SELECT set_config('app.rls_strict_mode', $1::text, true)`,
        [strictMode]
      );
    }

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
  role: string | null | undefined,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return queryRowsWithPgRlsContext<T>({ userId, role }, sql, params);
}

export async function queryRowsWithPgSystemContext<
  T extends QueryResultRow = QueryResultRow,
>(sql: string, params: unknown[] = []): Promise<T[]> {
  return queryRowsWithPgRlsContext<T>({ systemActor: true }, sql, params);
}
