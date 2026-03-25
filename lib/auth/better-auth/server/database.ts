import { memoryAdapter } from 'better-auth/adapters/memory';
import { Pool } from 'pg';

import { BETTER_AUTH_KYSELY_KEY, KyselyDb, MEMORY_DB_KEY } from './constants';

function getMemoryDb() {
  const globalState = globalThis as unknown as Record<string, unknown>;
  if (!globalState[MEMORY_DB_KEY]) {
    globalState[MEMORY_DB_KEY] = {};
  }

  const db = globalState[MEMORY_DB_KEY] as Record<string, unknown[]>;
  const requiredModels = ['user', 'session', 'account', 'verification'];

  requiredModels.forEach(model => {
    if (!Array.isArray(db[model])) {
      db[model] = [];
    }
  });

  return db;
}

function resolveDatabaseUrl(): string | null {
  const fromPrimary = process.env.DATABASE_URL?.trim();
  if (fromPrimary) {
    return fromPrimary;
  }

  const fallback = process.env.PGURL?.trim();
  if (fallback) {
    return fallback;
  }

  return null;
}

function loadKyselyRuntime(): {
  Kysely: new (config: unknown) => unknown;
  PostgresDialect: new (config: unknown) => unknown;
} {
  const runtimeRequire = eval('require') as (id: string) => unknown;

  try {
    return runtimeRequire('kysely') as {
      Kysely: new (config: unknown) => unknown;
      PostgresDialect: new (config: unknown) => unknown;
    };
  } catch (error) {
    throw new Error(
      `[better-auth] failed to load kysely runtime. Install "kysely" as a direct dependency. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function getKyselyDb(connectionString: string) {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[BETTER_AUTH_KYSELY_KEY] as KyselyDb | undefined;
  if (existing) {
    return existing;
  }

  const { Kysely, PostgresDialect } = loadKyselyRuntime();
  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_POOL_CONNECT_MS || 5000),
  });

  const db = new Kysely({
    dialect: new PostgresDialect({ pool }),
  }) as KyselyDb;

  globalState[BETTER_AUTH_KYSELY_KEY] = db;
  return db;
}

export function getAuthDatabaseConfig() {
  const databaseUrl = resolveDatabaseUrl();
  if (databaseUrl) {
    return {
      db: getKyselyDb(databaseUrl),
      type: 'postgres' as const,
    };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_URL (or PGURL) is required in production when better-auth is enabled'
    );
  }

  console.warn(
    '[better-auth] DATABASE_URL/PGURL is missing; using in-memory adapter (dev/test only)'
  );
  return memoryAdapter(getMemoryDb(), {});
}
