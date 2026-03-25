export interface CacheItem<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export interface CacheMetricsSnapshot {
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  l2Misses: number;
  l2ReadErrors: number;
  l2WriteErrors: number;
}

export interface RedisSetCommandOptions {
  EX?: number;
}

export interface RedisClientLike {
  isOpen: boolean;
  connect: () => Promise<void>;
  duplicate?: () => RedisClientLike;
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    options?: RedisSetCommandOptions
  ) => Promise<unknown>;
  del: (keys: string | string[]) => Promise<number>;
  publish?: (channel: string, message: string) => Promise<number>;
  subscribe?: (
    channel: string,
    listener: (message: string) => void
  ) => Promise<void>;
  quit?: () => Promise<void>;
  scanIterator: (options: {
    MATCH: string;
    COUNT?: number;
  }) => AsyncIterable<string | string[]>;
  on: (event: string, listener: (error: unknown) => void) => void;
}

export type RedisModule = {
  createClient: (options: {
    url: string;
    socket?: { connectTimeout?: number };
    pingInterval?: number;
  }) => RedisClientLike;
};

export type CacheInvalidationOperation =
  | 'set'
  | 'delete'
  | 'delete-pattern'
  | 'clear';

export interface CacheInvalidationMessage {
  origin: string;
  operation: CacheInvalidationOperation;
  key?: string;
  pattern?: string;
}
