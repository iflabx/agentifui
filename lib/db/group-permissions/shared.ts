import { callInternalDataAction } from '../internal-data-api';
import type { AppPermissionCheck } from './types';

export { callInternalDataAction };

async function getPool() {
  const { getPgPool } = await import('@lib/server/pg/pool');
  return getPgPool();
}

export async function queryRowsWithActorContext<T extends object>(
  actorUserId: string | undefined,
  sql: string,
  params: unknown[]
): Promise<T[]> {
  if (!actorUserId) {
    const pool = await getPool();
    const { rows } = await pool.query<T>(sql, params);
    return rows;
  }

  const { queryRowsWithPgUserContext } = await import(
    '@lib/server/pg/user-context'
  );
  return queryRowsWithPgUserContext<T>(actorUserId, sql, params);
}

export async function queryWithPool<T extends object>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = await getPool();
  const { rows } = await pool.query<T>(sql, params);
  return rows;
}

export type IncrementAppUsageResult = {
  success: boolean;
  new_used_count: number;
  quota_remaining: number | null;
  error_message: string | null;
};

export type PermissionCheckResult = AppPermissionCheck;
