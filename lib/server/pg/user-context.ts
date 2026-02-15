import type { PoolClient, QueryResultRow } from 'pg';

import { getPgPool } from './pool';

export async function runWithPgUserContext<T>(
  userId: string | null | undefined,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPgPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_user_id', $1::text, true)`,
      [userId ?? '']
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

export async function queryRowsWithPgUserContext<
  T extends QueryResultRow = QueryResultRow,
>(
  userId: string | null | undefined,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return runWithPgUserContext(userId, async client => {
    const { rows } = await client.query<T>(sql, params);
    return rows;
  });
}
