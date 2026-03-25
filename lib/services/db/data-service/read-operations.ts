import type { Result } from '@lib/types/result';

import { assertIdentifier, quoteIdentifier } from './identifiers';
import { normalizeRow } from './normalize';
import {
  buildOrderByClause,
  buildPaginationClause,
  buildWhereClause,
} from './query-helpers';
import type { DataServiceRealtimeSupport } from './realtime-support';
import { resolveManagedRepositoryForOwnedTable } from './repository';
import type {
  OrderByOption,
  PaginationOption,
  QueryOptions,
  QueryResultRow,
  RealtimeOptions,
  SqlPool,
} from './types';

interface ReadContext {
  getPool: () => SqlPool;
  query: <T>(
    operation: () => Promise<T>,
    cacheKey?: string,
    options?: QueryOptions
  ) => Promise<Result<T>>;
  realtime: Pick<DataServiceRealtimeSupport, 'registerSubscription'>;
}

export async function findOneRecord<T>(
  context: ReadContext,
  table: string,
  filters: Record<string, unknown>,
  options: QueryOptions & RealtimeOptions = {}
): Promise<Result<T | null>> {
  const safeTable = assertIdentifier(table, 'table');
  const filterStr = Object.entries(filters)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const cacheKey = options.cache ? `${table}:one:${filterStr}` : undefined;

  const result = await context.query(
    async () => {
      const pool = context.getPool();
      const repository = resolveManagedRepositoryForOwnedTable(safeTable, pool);
      if (repository) {
        const row = await repository.findOne(filters);
        return row ? normalizeRow<T>(row) : null;
      }

      const { clause, params } = buildWhereClause(filters, 1);
      const sql = `SELECT * FROM ${quoteIdentifier(safeTable)} ${clause} LIMIT 1`;
      const queryResult = await pool.query(sql, params);
      const row = queryResult.rows[0];
      return row ? normalizeRow<T>(row) : null;
    },
    cacheKey,
    options
  );

  if (options.subscribe && options.subscriptionKey && options.onUpdate) {
    context.realtime.registerSubscription(
      options.subscriptionKey,
      { event: '*', schema: 'public', table },
      options.onUpdate
    );
  }

  return result;
}

export async function findManyRecords<T>(
  context: ReadContext,
  table: string,
  filters: Record<string, unknown> = {},
  orderBy?: OrderByOption,
  pagination?: PaginationOption,
  options: QueryOptions & RealtimeOptions = {}
): Promise<Result<T[]>> {
  const safeTable = assertIdentifier(table, 'table');
  const filterStr = Object.entries(filters)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const orderStr = orderBy
    ? `${orderBy.column}:${orderBy.ascending ? 'asc' : 'desc'}`
    : '';
  const pageStr = pagination ? `${pagination.offset}:${pagination.limit}` : '';
  const cacheKey = options.cache
    ? `${table}:many:${filterStr}:${orderStr}:${pageStr}`
    : undefined;

  const result = await context.query(
    async () => {
      const pool = context.getPool();
      const repository = resolveManagedRepositoryForOwnedTable(safeTable, pool);
      if (repository) {
        const rows = await repository.findMany(filters, orderBy, pagination);
        return rows.map(row => normalizeRow<T>(row));
      }

      const { clause, params } = buildWhereClause(filters, 1);
      const orderClause = buildOrderByClause(orderBy);
      const paginationClause = buildPaginationClause(pagination);
      const sql = [
        `SELECT * FROM ${quoteIdentifier(safeTable)}`,
        clause,
        orderClause,
        paginationClause,
      ]
        .filter(Boolean)
        .join(' ');

      const queryResult = await pool.query(sql, params);
      return queryResult.rows.map(row => normalizeRow<T>(row));
    },
    cacheKey,
    options
  );

  if (options.subscribe && options.subscriptionKey && options.onUpdate) {
    context.realtime.registerSubscription(
      options.subscriptionKey,
      { event: '*', schema: 'public', table },
      options.onUpdate
    );
  }

  return result;
}

export async function countRecords(
  context: Omit<ReadContext, 'realtime'>,
  table: string,
  filters: Record<string, unknown> = {},
  options: QueryOptions = {}
): Promise<Result<number>> {
  const safeTable = assertIdentifier(table, 'table');
  const filterStr = Object.entries(filters)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const cacheKey = options.cache ? `${table}:count:${filterStr}` : undefined;

  return context.query(
    async () => {
      const pool = context.getPool();
      const repository = resolveManagedRepositoryForOwnedTable(safeTable, pool);
      if (repository) {
        return repository.count(filters);
      }

      const { clause, params } = buildWhereClause(filters, 1);
      const sql = `SELECT COUNT(*)::int AS total FROM ${quoteIdentifier(safeTable)} ${clause}`;
      const queryResult = await pool.query<{ total: number }>(sql, params);
      return Number(queryResult.rows[0]?.total || 0);
    },
    cacheKey,
    options
  );
}

export async function rawQueryRows<T extends QueryResultRow = QueryResultRow>(
  context: Omit<ReadContext, 'realtime'>,
  sql: string,
  params: unknown[] = [],
  options: QueryOptions = {}
): Promise<Result<T[]>> {
  return context.query(
    async () => {
      const pool = context.getPool();
      const queryResult = await pool.query<T>(sql, params);
      return queryResult.rows.map(row => normalizeRow<T>(row));
    },
    undefined,
    options
  );
}
