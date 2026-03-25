import type { Result } from '@lib/types/result';
import { DatabaseError } from '@lib/types/result';

import { cacheService } from '../cache-service';
import { assertIdentifier, quoteIdentifier } from './identifiers';
import { normalizeRow } from './normalize';
import { toSqlValue } from './query-helpers';
import type { DataServiceRealtimeSupport } from './realtime-support';
import { resolveManagedRepositoryForOwnedTable } from './repository';
import type { QueryOptions, QueryResultRow, SqlClient, SqlPool } from './types';

interface WriteContext {
  getPool: () => SqlPool;
  query: <T>(
    operation: () => Promise<T>,
    cacheKey?: string,
    options?: QueryOptions
  ) => Promise<Result<T>>;
  realtime: Pick<
    DataServiceRealtimeSupport,
    'capturePreviousRow' | 'publishTableChange'
  >;
}

export async function createRecord<T>(
  context: WriteContext,
  table: string,
  data: Partial<T>,
  options: QueryOptions = {}
): Promise<Result<T>> {
  const safeTable = assertIdentifier(table, 'table');

  const result = await context.query(
    async () => {
      const pool = context.getPool();
      const repository = resolveManagedRepositoryForOwnedTable(safeTable, pool);
      if (repository) {
        const row = await repository.create(data as Record<string, unknown>);
        return normalizeRow<T>(row);
      }

      const keys = Object.keys(data as Record<string, unknown>).filter(
        key => (data as Record<string, unknown>)[key] !== undefined
      );
      if (keys.length === 0) {
        throw new DatabaseError('Create data is empty', 'create');
      }

      keys.forEach(key => assertIdentifier(key, 'column'));
      const columnsSql = keys.map(key => quoteIdentifier(key)).join(', ');
      const values = keys.map(key =>
        toSqlValue((data as Record<string, unknown>)[key])
      );
      const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
      const sql = `INSERT INTO ${quoteIdentifier(safeTable)} (${columnsSql}) VALUES (${placeholders}) RETURNING *`;

      const queryResult = await pool.query(sql, values);
      const row = queryResult.rows[0];
      if (!row) {
        throw new DatabaseError('Create returned no row', 'create');
      }

      return normalizeRow<T>(row);
    },
    undefined,
    options
  );

  if (result.success) {
    cacheService.deletePattern(`${table}:*`);
    await context.realtime.publishTableChange({
      table: safeTable,
      eventType: 'INSERT',
      newRow: result.data,
      oldRow: null,
    });
  }

  return result;
}

export async function updateRecord<T>(
  context: WriteContext,
  table: string,
  id: string,
  data: Partial<T>,
  options: QueryOptions = {}
): Promise<Result<T>> {
  const safeTable = assertIdentifier(table, 'table');
  const previousRow = await context.realtime.capturePreviousRow(safeTable, id);

  const result = await context.query(
    async () => {
      const pool = context.getPool();
      const repository = resolveManagedRepositoryForOwnedTable(safeTable, pool);
      if (repository) {
        const row = await repository.update(
          id,
          data as Record<string, unknown>
        );

        if (!row) {
          throw new DatabaseError(`Record not found: ${id}`, 'update');
        }

        return normalizeRow<T>(row);
      }

      const keys = Object.keys(data as Record<string, unknown>).filter(
        key => (data as Record<string, unknown>)[key] !== undefined
      );
      if (keys.length === 0) {
        throw new DatabaseError('Update data is empty', 'update');
      }

      keys.forEach(key => assertIdentifier(key, 'column'));
      const setClauses = keys.map(
        (key, index) => `${quoteIdentifier(key)} = $${index + 1}`
      );
      const values = keys.map(key =>
        toSqlValue((data as Record<string, unknown>)[key])
      );
      values.push(id);

      const sql = `UPDATE ${quoteIdentifier(safeTable)} SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`;
      const queryResult = await pool.query(sql, values);
      const row = queryResult.rows[0];

      if (!row) {
        throw new DatabaseError(`Record not found: ${id}`, 'update');
      }

      return normalizeRow<T>(row);
    },
    undefined,
    options
  );

  if (result.success) {
    cacheService.deletePattern(`${table}:*`);
    await context.realtime.publishTableChange({
      table: safeTable,
      eventType: 'UPDATE',
      newRow: result.data,
      oldRow: previousRow,
    });
  }

  return result;
}

export async function deleteRecord(
  context: WriteContext,
  table: string,
  id: string,
  options: QueryOptions = {}
): Promise<Result<void>> {
  const safeTable = assertIdentifier(table, 'table');
  const previousRow = await context.realtime.capturePreviousRow(safeTable, id);

  const result = await context.query(
    async () => {
      const pool = context.getPool();
      const repository = resolveManagedRepositoryForOwnedTable(safeTable, pool);
      if (repository) {
        await repository.delete(id);
        return;
      }

      const sql = `DELETE FROM ${quoteIdentifier(safeTable)} WHERE id = $1`;
      await pool.query(sql, [id]);
    },
    undefined,
    options
  );

  if (result.success) {
    cacheService.deletePattern(`${table}:*`);
    await context.realtime.publishTableChange({
      table: safeTable,
      eventType: 'DELETE',
      newRow: null,
      oldRow: previousRow,
    });
  }

  return result;
}

export async function rawExecuteStatement(
  context: Omit<WriteContext, 'realtime'>,
  sql: string,
  params: unknown[] = [],
  options: QueryOptions = {}
): Promise<Result<number>> {
  return context.query(
    async () => {
      const pool = context.getPool();
      const queryResult = await pool.query(sql, params);
      return Number(queryResult.rowCount || 0);
    },
    undefined,
    options
  );
}

export async function runTransactionOperation<T>(
  context: Omit<WriteContext, 'realtime'>,
  operation: (client: SqlClient) => Promise<T>,
  options: QueryOptions = {}
): Promise<Result<T>> {
  return context.query(
    async () => {
      const pool = context.getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    undefined,
    options
  );
}
