/**
 * Unified Data Service Layer
 *
 * PostgreSQL-based implementation with cache, retries, and Result wrappers.
 * Keeps the same API surface used by legacy callers.
 */
import type { Result } from '@lib/types/result';

import { cacheService } from './cache-service';
import { getOrCreateSqlPool } from './data-service/pool';
import { DataServiceQueryRunner } from './data-service/query-runner';
import {
  countRecords,
  findManyRecords,
  findOneRecord,
  rawQueryRows,
} from './data-service/read-operations';
import { DataServiceRealtimeSupport } from './data-service/realtime-support';
import type {
  OrderByOption,
  PaginationOption,
  QueryOptions,
  QueryResultRow,
  RealtimeOptions,
  SqlClient,
  SqlPool,
} from './data-service/types';
import {
  createRecord,
  deleteRecord,
  rawExecuteStatement,
  runTransactionOperation,
  updateRecord,
} from './data-service/write-operations';
import { realtimeService } from './realtime-service';

export class DataService {
  private static instance: DataService;
  private readonly queryRunner = new DataServiceQueryRunner();
  private readonly realtimeSupport = new DataServiceRealtimeSupport(() =>
    this.getPool()
  );

  private constructor() {}

  public static getInstance(): DataService {
    if (!DataService.instance) {
      DataService.instance = new DataService();
    }
    return DataService.instance;
  }

  private getPool(): SqlPool {
    return getOrCreateSqlPool();
  }

  async query<T>(
    operation: () => Promise<T>,
    cacheKey?: string,
    options: QueryOptions = {}
  ): Promise<Result<T>> {
    return this.queryRunner.query(operation, cacheKey, options);
  }

  async executeQuery<T>(
    queryBuilder: (() => Promise<T>) | Promise<T>,
    operation: string,
    cacheKey?: string,
    options: QueryOptions = {}
  ): Promise<Result<T>> {
    return this.queryRunner.executeQuery(
      queryBuilder,
      operation,
      cacheKey,
      options
    );
  }

  async findOne<T>(
    table: string,
    filters: Record<string, unknown>,
    options: QueryOptions & RealtimeOptions = {}
  ): Promise<Result<T | null>> {
    return findOneRecord(
      {
        getPool: () => this.getPool(),
        query: this.query.bind(this),
        realtime: this.realtimeSupport,
      },
      table,
      filters,
      options
    );
  }

  async findMany<T>(
    table: string,
    filters: Record<string, unknown> = {},
    orderBy?: OrderByOption,
    pagination?: PaginationOption,
    options: QueryOptions & RealtimeOptions = {}
  ): Promise<Result<T[]>> {
    return findManyRecords(
      {
        getPool: () => this.getPool(),
        query: this.query.bind(this),
        realtime: this.realtimeSupport,
      },
      table,
      filters,
      orderBy,
      pagination,
      options
    );
  }

  async create<T>(
    table: string,
    data: Partial<T>,
    options: QueryOptions = {}
  ): Promise<Result<T>> {
    return createRecord(
      {
        getPool: () => this.getPool(),
        query: this.query.bind(this),
        realtime: this.realtimeSupport,
      },
      table,
      data,
      options
    );
  }

  async update<T>(
    table: string,
    id: string,
    data: Partial<T>,
    options: QueryOptions = {}
  ): Promise<Result<T>> {
    return updateRecord(
      {
        getPool: () => this.getPool(),
        query: this.query.bind(this),
        realtime: this.realtimeSupport,
      },
      table,
      id,
      data,
      options
    );
  }

  async delete(
    table: string,
    id: string,
    options: QueryOptions = {}
  ): Promise<Result<void>> {
    return deleteRecord(
      {
        getPool: () => this.getPool(),
        query: this.query.bind(this),
        realtime: this.realtimeSupport,
      },
      table,
      id,
      options
    );
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
    return countRecords(
      {
        getPool: () => this.getPool(),
        query: this.query.bind(this),
      },
      table,
      filters,
      options
    );
  }

  async rawQuery<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<Result<T[]>> {
    return rawQueryRows(
      {
        getPool: () => this.getPool(),
        query: this.query.bind(this),
      },
      sql,
      params,
      options
    );
  }

  async rawExecute(
    sql: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<Result<number>> {
    return rawExecuteStatement(
      {
        getPool: () => this.getPool(),
        query: this.query.bind(this),
      },
      sql,
      params,
      options
    );
  }

  async runInTransaction<T>(
    operation: (client: SqlClient) => Promise<T>,
    options: QueryOptions = {}
  ): Promise<Result<T>> {
    return runTransactionOperation(
      {
        getPool: () => this.getPool(),
        query: this.query.bind(this),
      },
      operation,
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
}

export const dataService = DataService.getInstance();
