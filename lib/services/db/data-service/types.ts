export interface QueryOptions {
  cache?: boolean;
  cacheTTL?: number;
  retries?: number;
  retryDelay?: number;
}

export interface RealtimeOptions {
  subscribe?: boolean;
  subscriptionKey?: string;
  onUpdate?: (payload: unknown) => void;
}

export type OrderByOption = { column: string; ascending?: boolean };
export type PaginationOption = { offset: number; limit: number };
export type WhereClause = {
  clause: string;
  params: unknown[];
};

export type QueryResultRow = object;
export type QueryResult<T extends QueryResultRow = QueryResultRow> = {
  rows: T[];
  rowCount: number | null;
};

export type SqlClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
  release: () => void;
};

export type SqlPool = {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
  connect: () => Promise<SqlClient>;
};

export type RealtimePublisher = (input: {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: import('../realtime-service').RealtimeRow | null;
  oldRow: import('../realtime-service').RealtimeRow | null;
  schema?: string;
  commitTimestamp?: string;
}) => Promise<void>;

export type TableAccessOwner = 'managed' | 'raw';
