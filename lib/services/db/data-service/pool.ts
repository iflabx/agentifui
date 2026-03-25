import { resolvePgSessionOptionsFromEnv } from '@lib/server/pg/session-options';
import { DatabaseError } from '@lib/types/result';

import { PG_POOL_GLOBAL_KEY } from './constants';
import type { SqlPool } from './types';

function resolveDatabaseUrl(): string {
  const fromPrimary = process.env.DATABASE_URL?.trim();
  if (fromPrimary) {
    return fromPrimary;
  }

  const fallback = process.env.PGURL?.trim();
  if (fallback) {
    return fallback;
  }

  throw new DatabaseError('DATABASE_URL (or PGURL) is required', 'pg_pool');
}

export function getOrCreateSqlPool(): SqlPool {
  if (typeof window !== 'undefined') {
    throw new DatabaseError(
      'PostgreSQL pool is not available in browser runtime',
      'pg_pool'
    );
  }

  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[PG_POOL_GLOBAL_KEY] as SqlPool | undefined;
  if (existing) {
    return existing;
  }

  const runtimeRequire = eval('require') as (id: string) => unknown;
  const pgModule = runtimeRequire('pg') as {
    Pool: new (config: {
      connectionString: string;
      max: number;
      idleTimeoutMillis: number;
      connectionTimeoutMillis: number;
      options?: string;
    }) => SqlPool;
  };

  const sessionOptions = resolvePgSessionOptionsFromEnv({
    systemActor: true,
  });
  const pool = new pgModule.Pool({
    connectionString: resolveDatabaseUrl(),
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_POOL_CONNECT_MS || 5000),
    ...(sessionOptions ? { options: sessionOptions } : {}),
  });

  globalState[PG_POOL_GLOBAL_KEY] = pool;
  return pool;
}
