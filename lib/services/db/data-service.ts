/**
 * Unified Data Service Layer
 *
 * PostgreSQL-based implementation with cache, retries, and Result wrappers.
 * Keeps the same API surface used by legacy callers.
 */
import { getManagedCrudRepository } from '@lib/server/db/repositories';
import { resolvePgSessionOptionsFromEnv } from '@lib/server/pg/session-options';
import {
  DatabaseError,
  Result,
  failure,
  success,
  wrapAsync,
} from '@lib/types/result';

import { cacheService } from './cache-service';
import { type RealtimeRow, realtimeService } from './realtime-service';

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

type QueryResultRow = object;
type QueryResult<T extends QueryResultRow = QueryResultRow> = {
  rows: T[];
  rowCount: number | null;
};
type SqlClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
  release: () => void;
};
type SqlPool = {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
  connect: () => Promise<SqlClient>;
};

type RealtimePublisher = (input: {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: RealtimeRow | null;
  oldRow: RealtimeRow | null;
  schema?: string;
  commitTimestamp?: string;
}) => Promise<void>;

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const PG_POOL_GLOBAL_KEY = '__agentifui_pg_pool__';
const REALTIME_ENABLED_TABLES = new Set([
  'profiles',
  'conversations',
  'messages',
  'providers',
  'service_instances',
  'api_keys',
]);

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
  private registeredRealtimeSubscriptions = new Set<string>();
  private realtimeHandlerIds = new WeakMap<
    (payload: unknown) => void,
    number
  >();
  private nextRealtimeHandlerId = 1;

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

  private getPool(): SqlPool {
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

    // Dynamic runtime require prevents client bundle from resolving node-only deps.
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

    const sessionOptions = resolvePgSessionOptionsFromEnv();
    const pool = new pgModule.Pool({
      connectionString: this.resolveDatabaseUrl(),
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PG_POOL_CONNECT_MS || 5000),
      ...(sessionOptions ? { options: sessionOptions } : {}),
    });

    globalState[PG_POOL_GLOBAL_KEY] = pool;
    return pool;
  }

  private resolveDatabaseUrl(): string {
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

  private loadRealtimeBridgeEnsurer(): (() => void) | null {
    if (typeof window !== 'undefined') {
      return null;
    }

    try {
      // Dynamic runtime require prevents client bundle from resolving node-only deps.
      const runtimeRequire = eval('require') as (id: string) => unknown;
      const bridgeModule = runtimeRequire('../../server/realtime/bridge') as {
        ensureRealtimeBridge?: () => void;
      };
      return typeof bridgeModule.ensureRealtimeBridge === 'function'
        ? bridgeModule.ensureRealtimeBridge
        : null;
    } catch (error) {
      console.warn(
        '[DataService] Failed to load realtime bridge module:',
        error
      );
      return null;
    }
  }

  private loadRealtimePublisher(): RealtimePublisher | null {
    if (typeof window !== 'undefined') {
      return null;
    }

    try {
      // Dynamic runtime require prevents client bundle from resolving node-only deps.
      const runtimeRequire = eval('require') as (id: string) => unknown;
      const publisherModule = runtimeRequire(
        '../../server/realtime/publisher'
      ) as {
        publishTableChangeEvent?: RealtimePublisher;
      };
      return typeof publisherModule.publishTableChangeEvent === 'function'
        ? publisherModule.publishTableChangeEvent
        : null;
    } catch (error) {
      console.warn(
        '[DataService] Failed to load realtime publisher module:',
        error
      );
      return null;
    }
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

  private shouldPublishRealtimeForTable(table: string): boolean {
    return REALTIME_ENABLED_TABLES.has(table);
  }

  private normalizeRealtimeRow(value: unknown): RealtimeRow | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return this.normalizeRow<RealtimeRow>(value);
  }

  private async loadRowById(
    table: string,
    id: string
  ): Promise<RealtimeRow | null> {
    const safeTable = assertIdentifier(table, 'table');
    const repository = getManagedCrudRepository(safeTable, this.getPool());
    if (repository) {
      const row = await repository.findOne({ id });
      return row ? this.normalizeRow<RealtimeRow>(row) : null;
    }

    const sql = `SELECT * FROM ${quoteIdentifier(safeTable)} WHERE id = $1 LIMIT 1`;
    const pool = this.getPool();
    const queryResult = await pool.query(sql, [id]);
    const row = queryResult.rows[0];
    return row ? this.normalizeRow<RealtimeRow>(row) : null;
  }

  private async publishRealtimeTableChange(input: {
    table: string;
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    newRow: unknown;
    oldRow: unknown;
  }): Promise<void> {
    if (!this.shouldPublishRealtimeForTable(input.table)) {
      return;
    }

    const newRow = this.normalizeRealtimeRow(input.newRow);
    const oldRow = this.normalizeRealtimeRow(input.oldRow);
    if (!newRow && !oldRow) {
      return;
    }

    try {
      const publisher = this.loadRealtimePublisher();
      if (!publisher) {
        return;
      }

      await publisher({
        table: input.table,
        eventType: input.eventType,
        newRow,
        oldRow,
      });
    } catch (error) {
      console.warn('[DataService] Realtime publish failed:', error);
    }
  }

  private registerRealtimeSubscription(
    key: string,
    config: {
      event: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
      schema: string;
      table: string;
      filter?: string;
    },
    handler: (payload: unknown) => void
  ): void {
    const handlerId = this.getRealtimeHandlerId(handler);
    const dedupeKey = `${key}|${config.schema}|${config.table}|${config.event}|${config.filter || ''}|h:${handlerId}`;
    if (this.registeredRealtimeSubscriptions.has(dedupeKey)) {
      return;
    }

    if (typeof window === 'undefined') {
      const ensureBridge = this.loadRealtimeBridgeEnsurer();
      ensureBridge?.();
    }

    this.registeredRealtimeSubscriptions.add(dedupeKey);
    realtimeService.subscribe(key, config, handler);
  }

  private getRealtimeHandlerId(handler: (payload: unknown) => void): number {
    const existing = this.realtimeHandlerIds.get(handler);
    if (existing) {
      return existing;
    }

    const created = this.nextRealtimeHandlerId++;
    this.realtimeHandlerIds.set(handler, created);
    return created;
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
        const repository = getManagedCrudRepository(safeTable, this.getPool());
        if (repository) {
          const row = await repository.findOne(filters);
          return row ? this.normalizeRow<T>(row) : null;
        }

        const { clause, params } = this.buildWhereClause(filters, 1);
        const sql = `SELECT * FROM ${quoteIdentifier(safeTable)} ${clause} LIMIT 1`;
        const pool = this.getPool();
        const queryResult = await pool.query(sql, params);
        const row = queryResult.rows[0];
        return row ? this.normalizeRow<T>(row) : null;
      },
      cacheKey,
      options
    );

    if (options.subscribe && options.subscriptionKey && options.onUpdate) {
      this.registerRealtimeSubscription(
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
        const repository = getManagedCrudRepository(safeTable, this.getPool());
        if (repository) {
          const rows = await repository.findMany(filters, orderBy, pagination);
          return rows.map(row => this.normalizeRow<T>(row));
        }

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

        const pool = this.getPool();
        const queryResult = await pool.query(sql, params);
        return queryResult.rows.map(row => this.normalizeRow<T>(row));
      },
      cacheKey,
      options
    );

    if (options.subscribe && options.subscriptionKey && options.onUpdate) {
      this.registerRealtimeSubscription(
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
        const repository = getManagedCrudRepository(safeTable, this.getPool());
        if (repository) {
          const row = await repository.create(data as Record<string, unknown>);
          return this.normalizeRow<T>(row);
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
          this.toSqlValue((data as Record<string, unknown>)[key])
        );
        const placeholders = values
          .map((_, index) => `$${index + 1}`)
          .join(', ');
        const sql = `INSERT INTO ${quoteIdentifier(safeTable)} (${columnsSql}) VALUES (${placeholders}) RETURNING *`;

        const pool = this.getPool();
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
      await this.publishRealtimeTableChange({
        table: safeTable,
        eventType: 'INSERT',
        newRow: result.data,
        oldRow: null,
      });
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
    const previousRow = this.shouldPublishRealtimeForTable(safeTable)
      ? await this.loadRowById(safeTable, id).catch(() => null)
      : null;

    const result = await this.query(
      async () => {
        const repository = getManagedCrudRepository(safeTable, this.getPool());
        if (repository) {
          const row = await repository.update(
            id,
            data as Record<string, unknown>
          );

          if (!row) {
            throw new DatabaseError(`Record not found: ${id}`, 'update');
          }

          return this.normalizeRow<T>(row);
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
          this.toSqlValue((data as Record<string, unknown>)[key])
        );
        values.push(id);

        const sql = `UPDATE ${quoteIdentifier(safeTable)} SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`;
        const pool = this.getPool();
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
      await this.publishRealtimeTableChange({
        table: safeTable,
        eventType: 'UPDATE',
        newRow: result.data,
        oldRow: previousRow,
      });
    }

    return result;
  }

  async delete(
    table: string,
    id: string,
    options: QueryOptions = {}
  ): Promise<Result<void>> {
    const safeTable = assertIdentifier(table, 'table');
    const previousRow = this.shouldPublishRealtimeForTable(safeTable)
      ? await this.loadRowById(safeTable, id).catch(() => null)
      : null;

    const result = await this.query(
      async () => {
        const repository = getManagedCrudRepository(safeTable, this.getPool());
        if (repository) {
          await repository.delete(id);
          return;
        }

        const sql = `DELETE FROM ${quoteIdentifier(safeTable)} WHERE id = $1`;
        const pool = this.getPool();
        await pool.query(sql, [id]);
      },
      undefined,
      options
    );

    if (result.success) {
      cacheService.deletePattern(`${table}:*`);
      await this.publishRealtimeTableChange({
        table: safeTable,
        eventType: 'DELETE',
        newRow: null,
        oldRow: previousRow,
      });
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
        const repository = getManagedCrudRepository(safeTable, this.getPool());
        if (repository) {
          return repository.count(filters);
        }

        const { clause, params } = this.buildWhereClause(filters, 1);
        const sql = `SELECT COUNT(*)::int AS total FROM ${quoteIdentifier(safeTable)} ${clause}`;
        const pool = this.getPool();
        const queryResult = await pool.query<{ total: number }>(sql, params);
        return Number(queryResult.rows[0]?.total || 0);
      },
      cacheKey,
      options
    );
  }

  async rawQuery<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<Result<T[]>> {
    return this.query(
      async () => {
        const pool = this.getPool();
        const queryResult = await pool.query<T>(sql, params);
        return queryResult.rows.map(row => this.normalizeRow<T>(row));
      },
      undefined,
      options
    );
  }

  async rawExecute(
    sql: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<Result<number>> {
    return this.query(
      async () => {
        const pool = this.getPool();
        const queryResult = await pool.query(sql, params);
        return Number(queryResult.rowCount || 0);
      },
      undefined,
      options
    );
  }

  async runInTransaction<T>(
    operation: (client: SqlClient) => Promise<T>,
    options: QueryOptions = {}
  ): Promise<Result<T>> {
    return this.query(
      async () => {
        const pool = this.getPool();
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
