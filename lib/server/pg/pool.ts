import { Pool } from 'pg';

import { resolvePgSessionOptionsFromEnv } from './session-options';

const PG_POOL_GLOBAL_KEY = '__agentifui_pg_pool__';

function resolveDatabaseUrl(): string {
  const fromPrimary = process.env.DATABASE_URL?.trim();
  if (fromPrimary) {
    return fromPrimary;
  }

  const fallback = process.env.PGURL?.trim();
  if (fallback) {
    return fallback;
  }

  throw new Error('DATABASE_URL (or PGURL) is required');
}

export function getPgPool(): Pool {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[PG_POOL_GLOBAL_KEY] as Pool | undefined;
  if (existing) {
    return existing;
  }

  const sessionOptions = resolvePgSessionOptionsFromEnv();
  const pool = new Pool({
    connectionString: resolveDatabaseUrl(),
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_POOL_CONNECT_MS || 5000),
    ...(sessionOptions ? { options: sessionOptions } : {}),
  });

  globalState[PG_POOL_GLOBAL_KEY] = pool;
  return pool;
}
