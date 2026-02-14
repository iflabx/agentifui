/**
 * Unified Data Service Layer
 *
 * PostgreSQL-based implementation with cache, retries, and Result wrappers.
 * Keeps the same API surface used by legacy callers.
 */
import { getPgPool } from '@lib/server/pg/pool';
import {
  DatabaseError,
  Result,
  failure,
  success,
  wrapAsync,
} from '@lib/types/result';

import { cacheService } from './cache-service';
import { realtimeService } from './realtime-service';

interface QueryOptions {
  cache?: boolean;
  cacheTTL?: number;
  retries?: number;
  retryDelay?: number;
}

interface RealtimeOptions {
  subscribe?: boolean;
  subscriptionKey?: string;
  onUpdate?: (payload: unknown) => void;
}

type OrderByOption = { column: string; ascending?: boolean };
type PaginationOption = { offset: number; limit: number };
type WhereClause = {
  clause: string;
  params: unknown[];
};

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertIdentifier(identifier: string, label: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new DatabaseError(`Invalid ${label}: ${identifier}`, 'sql_guard');
  }
  return identifier;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
}

export class DataService {
  private static instance: DataService;

  private constructor() {}

  /**
   * Get the singleton instance of the data service.
   */
  public static getInstance(): DataService {
    if (!DataService.instance) {
      DataService.instance = new DataService();
    }
    return DataService.instance;
  }

  /**
   * General query method with cache and error handling.
   */
  async query<T>(
    operation: () => Promise<T>,
    cacheKey?: string,
    options: QueryOptions = {}
  ): Promise<Result<T>> {
    const {
      cache = false,
      cacheTTL = 5 * 60 * 1000,
      retries = 3,
      retryDelay = 1000,
    } = options;

    if (cache && cacheKey) {
      try {
        return success(await cacheService.get(cacheKey, operation, cacheTTL));
      } catch (error) {
        return failure(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const result = await wrapAsync(operation);

      if (result.success) {
        return result;
      }

      if (attempt === retries || this.isNonRetryableError(result.error)) {
        return result;
      }

      await this.delay(retryDelay * attempt);
      console.log(
        `[DataService] Retry attempt ${attempt}, error:`,
        result.error.message
      );
    }

    return failure(
      new DatabaseError('Query failed, max retries reached', 'query')
    );
  }

  private isNonRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('unique constraint') ||
      message.includes('foreign key') ||
      message.includes('check constraint') ||
      message.includes('not null') ||
      message.includes('permission denied') ||
      message.includes('row level security')
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Legacy compatibility helper.
   * Existing callers used to pass a Supabase query builder; now pass an async function.
   */
  async executeQuery<T>(
    queryBuilder: (() => Promise<T>) | Promise<T>,
    operation: string,
    cacheKey?: string,
    options: QueryOptions = {}
  ): Promise<Result<T>> {
    const operationRunner =
      typeof queryBuilder === 'function'
        ? (queryBuilder as () => Promise<T>)
        : async () => queryBuilder;

    return this.query(
      async () => {
        try {
          return await operationRunner();
        } catch (error) {
          throw new DatabaseError(
            `${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
            operation,
            error instanceof Error ? error : undefined
          );
        }
      },
      cacheKey,
      options
    );
  }

  async findOne<T>(
    table: string,
    filters: Record<string, unknown>,
    options: QueryOptions & RealtimeOptions = {}
  ): Promise<Result<T | null>> {
    const safeTable = assertIdentifier(table, 'table');
    const filterStr = Object.entries(filters)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    const cacheKey = options.cache ? `${table}:one:${filterStr}` : undefined;

    const result = await this.query(
      async () => {
        const { clause, params } = this.buildWhereClause(filters, 1);
        const sql = `SELECT * FROM ${quoteIdentifier(safeTable)} ${clause} LIMIT 1`;
        const pool = getPgPool();
        const queryResult = await pool.query(sql, params);
        const row = queryResult.rows[0];
        return row ? this.normalizeRow<T>(row) : null;
      },
      cacheKey,
      options
    );

    if (options.subscribe && options.subscriptionKey && options.onUpdate) {
      realtimeService.subscribe(
        options.subscriptionKey,
        { event: '*', schema: 'public', table },
        options.onUpdate
      );
    }

    return result;
  }

  async findMany<T>(
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
    const pageStr = pagination
      ? `${pagination.offset}:${pagination.limit}`
      : '';
    const cacheKey = options.cache
      ? `${table}:many:${filterStr}:${orderStr}:${pageStr}`
      : undefined;

    const result = await this.query(
      async () => {
        const { clause, params } = this.buildWhereClause(filters, 1);
        const orderClause = this.buildOrderByClause(orderBy);
        const paginationClause = this.buildPaginationClause(pagination);
        const sql = [
          `SELECT * FROM ${quoteIdentifier(safeTable)}`,
          clause,
          orderClause,
          paginationClause,
        ]
          .filter(Boolean)
          .join(' ');

        const pool = getPgPool();
        const queryResult = await pool.query(sql, params);
        return queryResult.rows.map(row => this.normalizeRow<T>(row));
      },
      cacheKey,
      options
    );

    if (options.subscribe && options.subscriptionKey && options.onUpdate) {
      realtimeService.subscribe(
        options.subscriptionKey,
        { event: '*', schema: 'public', table },
        options.onUpdate
      );
    }

    return result;
  }

  async create<T>(
    table: string,
    data: Partial<T>,
    options: QueryOptions = {}
  ): Promise<Result<T>> {
    const safeTable = assertIdentifier(table, 'table');

    const result = await this.query(
      async () => {
        const keys = Object.keys(data as Record<string, unknown>).filter(
          key => (data as Record<string, unknown>)[key] !== undefined
        );
        if (keys.length === 0) {
          throw new DatabaseError('Create data is empty', 'create');
        }

        keys.forEach(key => assertIdentifier(key, 'column'));
        const columnsSql = keys.map(key => quoteIdentifier(key)).join(', ');
        const values = keys.map(key =>
          this.toSqlValue((data as Record<string, unknown>)[key])
        );
        const placeholders = values
          .map((_, index) => `$${index + 1}`)
          .join(', ');
        const sql = `INSERT INTO ${quoteIdentifier(safeTable)} (${columnsSql}) VALUES (${placeholders}) RETURNING *`;

        const pool = getPgPool();
        const queryResult = await pool.query(sql, values);
        const row = queryResult.rows[0];
        if (!row) {
          throw new DatabaseError('Create returned no row', 'create');
        }
        return this.normalizeRow<T>(row);
      },
      undefined,
      options
    );

    if (result.success) {
      cacheService.deletePattern(`${table}:*`);
    }

    return result;
  }

  async update<T>(
    table: string,
    id: string,
    data: Partial<T>,
    options: QueryOptions = {}
  ): Promise<Result<T>> {
    const safeTable = assertIdentifier(table, 'table');

    const result = await this.query(
      async () => {
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
          this.toSqlValue((data as Record<string, unknown>)[key])
        );
        values.push(id);

        const sql = `UPDATE ${quoteIdentifier(safeTable)} SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`;
        const pool = getPgPool();
        const queryResult = await pool.query(sql, values);
        const row = queryResult.rows[0];

        if (!row) {
          throw new DatabaseError(`Record not found: ${id}`, 'update');
        }

        return this.normalizeRow<T>(row);
      },
      undefined,
      options
    );

    if (result.success) {
      cacheService.deletePattern(`${table}:*`);
    }

    return result;
  }

  async delete(
    table: string,
    id: string,
    options: QueryOptions = {}
  ): Promise<Result<void>> {
    const safeTable = assertIdentifier(table, 'table');

    const result = await this.query(
      async () => {
        const sql = `DELETE FROM ${quoteIdentifier(safeTable)} WHERE id = $1`;
        const pool = getPgPool();
        await pool.query(sql, [id]);
      },
      undefined,
      options
    );

    if (result.success) {
      cacheService.deletePattern(`${table}:*`);
    }

    return result;
  }

  async softDelete<T>(
    table: string,
    id: string,
    options: QueryOptions = {}
  ): Promise<Result<T>> {
    const softDeletePatch = {
      status: 'deleted',
      updated_at: new Date().toISOString(),
    } as unknown as Partial<T>;

    return this.update<T>(table, id, softDeletePatch, options);
  }

  async count(
    table: string,
    filters: Record<string, unknown> = {},
    options: QueryOptions = {}
  ): Promise<Result<number>> {
    const safeTable = assertIdentifier(table, 'table');
    const filterStr = Object.entries(filters)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    const cacheKey = options.cache ? `${table}:count:${filterStr}` : undefined;

    return this.query(
      async () => {
        const { clause, params } = this.buildWhereClause(filters, 1);
        const sql = `SELECT COUNT(*)::int AS total FROM ${quoteIdentifier(safeTable)} ${clause}`;
        const pool = getPgPool();
        const queryResult = await pool.query<{ total: number }>(sql, params);
        return Number(queryResult.rows[0]?.total || 0);
      },
      cacheKey,
      options
    );
  }

  clearCache(table: string): number {
    return cacheService.deletePattern(`${table}:*`);
  }

  clearAllCache(): void {
    cacheService.clear();
  }

  destroy(): void {
    cacheService.destroy();
    realtimeService.destroy();
  }

  private buildWhereClause(
    filters: Record<string, unknown>,
    startIndex: number
  ): WhereClause {
    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let index = startIndex;

    Object.entries(filters).forEach(([key, rawValue]) => {
      if (rawValue === undefined) {
        return;
      }

      const safeColumn = assertIdentifier(key, 'column');
      if (rawValue === null) {
        whereClauses.push(`${quoteIdentifier(safeColumn)} IS NULL`);
        return;
      }

      whereClauses.push(`${quoteIdentifier(safeColumn)} = $${index}`);
      params.push(this.toSqlValue(rawValue));
      index += 1;
    });

    if (whereClauses.length === 0) {
      return { clause: '', params: [] };
    }

    return {
      clause: `WHERE ${whereClauses.join(' AND ')}`,
      params,
    };
  }

  private buildOrderByClause(orderBy?: OrderByOption): string {
    if (!orderBy) {
      return '';
    }

    const safeColumn = assertIdentifier(orderBy.column, 'column');
    return `ORDER BY ${quoteIdentifier(safeColumn)} ${orderBy.ascending ? 'ASC' : 'DESC'}`;
  }

  private buildPaginationClause(pagination?: PaginationOption): string {
    if (!pagination) {
      return '';
    }

    const offset = Math.max(0, Number(pagination.offset || 0));
    const limit = Math.max(0, Number(pagination.limit || 0));
    return `LIMIT ${limit} OFFSET ${offset}`;
  }

  private toSqlValue(value: unknown): unknown {
    if (value === undefined) {
      return null;
    }

    if (value instanceof Date) {
      return value;
    }

    if (value && typeof value === 'object') {
      return JSON.stringify(value);
    }

    return value;
  }

  private normalizeRow<T>(row: unknown): T {
    return this.normalizeValue(row) as T;
  }

  private normalizeValue(value: unknown): unknown {
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      return value.map(item => this.normalizeValue(item));
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};
      Object.entries(record).forEach(([key, entryValue]) => {
        normalized[key] = this.normalizeValue(entryValue);
      });
      return normalized;
    }

    return value;
  }
}

export const dataService = DataService.getInstance();
