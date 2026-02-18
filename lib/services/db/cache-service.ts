/**
 * Unified cache service
 *
 * L1: in-process cache
 * L2 (optional, server runtime only): Redis
 */

interface CacheItem<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface CacheMetricsSnapshot {
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  l2Misses: number;
  l2ReadErrors: number;
  l2WriteErrors: number;
}

interface RedisSetCommandOptions {
  EX?: number;
}

interface RedisClientLike {
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

type RedisModule = {
  createClient: (options: {
    url: string;
    socket?: { connectTimeout?: number };
    pingInterval?: number;
  }) => RedisClientLike;
};

function parseBooleanEnv(
  value: string | undefined,
  fallback: boolean
): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function toSeconds(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(ms / 1000));
}

function toPositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function escapeRegexPattern(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

type CacheInvalidationOperation = 'set' | 'delete' | 'delete-pattern' | 'clear';

interface CacheInvalidationMessage {
  origin: string;
  operation: CacheInvalidationOperation;
  key?: string;
  pattern?: string;
}

const CACHE_INVALIDATION_ORIGIN_GLOBAL_KEY =
  '__agentifui_cache_invalidation_origin__';

function resolveInvalidationOrigin(): string {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[CACHE_INVALIDATION_ORIGIN_GLOBAL_KEY];
  if (typeof existing === 'string' && existing.length > 0) {
    return existing;
  }
  const created = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  globalState[CACHE_INVALIDATION_ORIGIN_GLOBAL_KEY] = created;
  return created;
}

export class CacheService {
  private static instance: CacheService;
  private cache = new Map<string, CacheItem<unknown>>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private inflight = new Map<string, Promise<unknown>>();
  private redisClient: RedisClientLike | null | undefined;
  private redisSubscriber: RedisClientLike | null | undefined;
  private redisSubscriberInitPromise: Promise<void> | null = null;
  private redisLoadWarned = false;
  private redisRuntimeWarned = false;
  private redisInvalidationWarned = false;

  private readonly redisL2Enabled: boolean;
  private readonly redisKeyPrefix: string;
  private readonly redisInvalidationEnabled: boolean;
  private readonly redisInvalidationChannel: string;
  private readonly invalidationOrigin: string;
  private readonly debugLogs: boolean;

  private metrics: CacheMetricsSnapshot = {
    l1Hits: 0,
    l1Misses: 0,
    l2Hits: 0,
    l2Misses: 0,
    l2ReadErrors: 0,
    l2WriteErrors: 0,
  };

  private constructor() {
    this.redisL2Enabled = parseBooleanEnv(
      process.env.CACHE_L2_REDIS_ENABLED,
      true
    );
    this.redisKeyPrefix = (
      process.env.CACHE_L2_KEY_PREFIX?.trim() || 'cache:l2'
    ).replace(/:+$/g, '');
    this.debugLogs = parseBooleanEnv(process.env.CACHE_DEBUG_LOGS, false);
    this.redisInvalidationEnabled =
      this.redisL2Enabled &&
      parseBooleanEnv(process.env.CACHE_L2_REDIS_INVALIDATION_ENABLED, true);
    this.redisInvalidationChannel =
      process.env.CACHE_L2_INVALIDATION_CHANNEL?.trim() ||
      `${this.redisKeyPrefix}:invalidate`;
    this.invalidationOrigin = resolveInvalidationOrigin();

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, 60000);
  }

  /**
   * Get the singleton instance of the cache service
   */
  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  private isServerRuntime(): boolean {
    return typeof window === 'undefined';
  }

  private logDebug(message: string): void {
    if (!this.debugLogs) {
      return;
    }
    console.log(`[CacheService] ${message}`);
  }

  private warnRedisLoadFailureOnce(error: unknown): void {
    if (this.redisLoadWarned) {
      return;
    }
    this.redisLoadWarned = true;
    console.warn(
      '[CacheService] Redis L2 disabled due to load/init failure:',
      error instanceof Error ? error.message : String(error)
    );
  }

  private disableRedisL2AfterRuntimeFailure(
    operation: string,
    error: unknown
  ): void {
    if (!this.redisRuntimeWarned) {
      this.redisRuntimeWarned = true;
      console.warn(
        `[CacheService] Redis L2 disabled after ${operation} failure:`,
        error instanceof Error ? error.message : String(error)
      );
    }
    this.redisClient = null;
  }

  private warnRedisInvalidationOnce(operation: string, error: unknown): void {
    if (this.redisInvalidationWarned) {
      return;
    }
    this.redisInvalidationWarned = true;
    console.warn(
      `[CacheService] Redis invalidation disabled after ${operation} failure:`,
      error instanceof Error ? error.message : String(error)
    );
  }

  private deletePatternLocal(pattern: string): number {
    let deletedCount = 0;
    const regex = new RegExp(
      `^${escapeRegexPattern(pattern).replace(/\*/g, '.*')}$`
    );

    for (const key of this.cache.keys()) {
      if (!regex.test(key)) {
        continue;
      }
      this.cache.delete(key);
      this.inflight.delete(key);
      deletedCount += 1;
    }

    return deletedCount;
  }

  private clearLocal(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  private applyRemoteInvalidation(message: CacheInvalidationMessage): void {
    if (!message || message.origin === this.invalidationOrigin) {
      return;
    }

    if (message.operation === 'clear') {
      this.clearLocal();
      return;
    }

    if (message.operation === 'set' || message.operation === 'delete') {
      if (!message.key) {
        return;
      }
      this.cache.delete(message.key);
      this.inflight.delete(message.key);
      return;
    }

    if (message.operation === 'delete-pattern' && message.pattern) {
      this.deletePatternLocal(message.pattern);
    }
  }

  private async ensureInvalidationSubscriber(
    redis: RedisClientLike
  ): Promise<void> {
    if (!this.redisInvalidationEnabled || !this.isServerRuntime()) {
      return;
    }

    if (this.redisSubscriber) {
      return;
    }
    if (this.redisSubscriberInitPromise) {
      await this.redisSubscriberInitPromise;
      return;
    }

    if (typeof redis.duplicate !== 'function') {
      return;
    }

    this.redisSubscriberInitPromise = (async () => {
      try {
        const subscriber = redis.duplicate!();
        if (!subscriber.isOpen) {
          await subscriber.connect();
        }
        if (typeof subscriber.subscribe !== 'function') {
          return;
        }

        await subscriber.subscribe(
          this.redisInvalidationChannel,
          rawMessage => {
            try {
              const parsed = JSON.parse(rawMessage) as CacheInvalidationMessage;
              this.applyRemoteInvalidation(parsed);
            } catch (error) {
              this.warnRedisInvalidationOnce(
                'invalidation payload parse',
                error
              );
            }
          }
        );
        this.redisSubscriber = subscriber;
      } catch (error) {
        this.warnRedisInvalidationOnce('invalidation subscribe', error);
      }
    })();

    try {
      await this.redisSubscriberInitPromise;
    } finally {
      this.redisSubscriberInitPromise = null;
    }
  }

  private async publishInvalidation(
    operation: CacheInvalidationOperation,
    input: { key?: string; pattern?: string } = {}
  ): Promise<void> {
    if (!this.redisInvalidationEnabled || !this.isServerRuntime()) {
      return;
    }
    const redis = await this.getRedisClient();
    if (!redis || typeof redis.publish !== 'function') {
      return;
    }
    try {
      await redis.publish(
        this.redisInvalidationChannel,
        JSON.stringify({
          origin: this.invalidationOrigin,
          operation,
          ...input,
        } satisfies CacheInvalidationMessage)
      );
    } catch (error) {
      this.warnRedisInvalidationOnce('invalidation publish', error);
    }
  }

  private resolveRedisUrl(): string | null {
    const fromPrimary = process.env.REDIS_URL?.trim();
    if (fromPrimary) {
      return fromPrimary;
    }

    const host = process.env.REDIS_HOST?.trim();
    if (!host) {
      return null;
    }

    const port = process.env.REDIS_PORT?.trim() || '6379';
    const db = process.env.REDIS_DB?.trim() || '0';
    const password = process.env.REDIS_PASSWORD?.trim();

    if (password) {
      return `redis://:${encodeURIComponent(password)}@${host}:${port}/${db}`;
    }

    return `redis://${host}:${port}/${db}`;
  }

  private createRedisClient(redisUrl: string): RedisClientLike {
    const runtimeRequire = eval('require') as (id: string) => unknown;
    const redisModule = runtimeRequire('redis') as RedisModule;
    const client = redisModule.createClient({
      url: redisUrl,
      socket: {
        connectTimeout: toPositiveNumber(
          process.env.REDIS_CONNECT_TIMEOUT_MS,
          5000
        ),
      },
      pingInterval: toPositiveNumber(process.env.REDIS_PING_INTERVAL_MS, 10000),
    });

    client.on('error', error => {
      console.error('[CacheService] Redis client error:', error);
    });

    return client;
  }

  private async getRedisClient(): Promise<RedisClientLike | null> {
    if (!this.isServerRuntime() || !this.redisL2Enabled) {
      return null;
    }

    const redisUrl = this.resolveRedisUrl();
    if (!redisUrl) {
      this.redisClient = null;
      return null;
    }

    if (this.redisClient !== undefined) {
      if (this.redisClient && !this.redisClient.isOpen) {
        try {
          await this.redisClient.connect();
        } catch (error) {
          this.disableRedisL2AfterRuntimeFailure('redis connect', error);
          return null;
        }
      }
      if (this.redisClient) {
        void this.ensureInvalidationSubscriber(this.redisClient);
      }
      return this.redisClient;
    }

    try {
      const client = this.createRedisClient(redisUrl);
      if (!client.isOpen) {
        await client.connect();
      }

      this.redisClient = client;
      void this.ensureInvalidationSubscriber(client);
      return client;
    } catch (error) {
      this.warnRedisLoadFailureOnce(error);
      this.redisClient = null;
      return null;
    }
  }

  private toRedisKey(key: string): string {
    const normalized = key.trim().replace(/^:+|:+$/g, '');
    return `${this.redisKeyPrefix}:${normalized}`;
  }

  private isExpired(item: CacheItem<unknown>, now = Date.now()): boolean {
    return now - item.timestamp >= item.ttl;
  }

  private readL1<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }
    if (this.isExpired(item)) {
      this.cache.delete(key);
      return null;
    }
    return item.data as T;
  }

  private setL1<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  private async readL2<T>(key: string, ttl: number): Promise<T | null> {
    const redis = await this.getRedisClient();
    if (!redis) {
      return null;
    }

    try {
      const raw = await redis.get(this.toRedisKey(key));
      if (raw === null) {
        this.metrics.l2Misses += 1;
        this.logDebug(`L2 miss: ${key}`);
        return null;
      }

      const value = JSON.parse(raw) as T;
      this.metrics.l2Hits += 1;
      this.setL1(key, value, ttl);
      this.logDebug(`L2 hit: ${key}`);
      return value;
    } catch (error) {
      this.metrics.l2ReadErrors += 1;
      this.disableRedisL2AfterRuntimeFailure('L2 read', error);
      return null;
    }
  }

  private async writeL2<T>(key: string, data: T, ttl: number): Promise<void> {
    const redis = await this.getRedisClient();
    if (!redis) {
      return;
    }

    try {
      await redis.set(this.toRedisKey(key), JSON.stringify(data), {
        EX: toSeconds(ttl),
      });
      this.logDebug(`L2 write: ${key}`);
    } catch (error) {
      this.metrics.l2WriteErrors += 1;
      this.disableRedisL2AfterRuntimeFailure('L2 write', error);
    }
  }

  private async deleteL2Key(key: string): Promise<void> {
    const redis = await this.getRedisClient();
    if (!redis) {
      return;
    }

    try {
      await redis.del(this.toRedisKey(key));
    } catch (error) {
      this.metrics.l2WriteErrors += 1;
      this.disableRedisL2AfterRuntimeFailure('L2 delete', error);
    }
  }

  private async deleteL2Pattern(pattern: string): Promise<void> {
    const redis = await this.getRedisClient();
    if (!redis) {
      return;
    }

    try {
      const toDelete: string[] = [];
      for await (const cursorValue of redis.scanIterator({
        MATCH: this.toRedisKey(pattern),
        COUNT: 100,
      })) {
        if (Array.isArray(cursorValue)) {
          toDelete.push(...cursorValue);
        } else if (typeof cursorValue === 'string') {
          toDelete.push(cursorValue);
        }
      }

      if (toDelete.length > 0) {
        await redis.del(toDelete);
      }
    } catch (error) {
      this.metrics.l2WriteErrors += 1;
      this.disableRedisL2AfterRuntimeFailure('L2 pattern delete', error);
    }
  }

  /**
   * Get cached data. If not present or expired, execute fetcher.
   * @param key Cache key
   * @param fetcher Data fetch function
   * @param ttl Time to live (ms), default 5 minutes
   */
  async get<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 5 * 60 * 1000
  ): Promise<T> {
    const l1Value = this.readL1<T>(key);
    if (l1Value !== null) {
      this.metrics.l1Hits += 1;
      this.logDebug(`L1 hit: ${key}`);
      return l1Value;
    }

    this.metrics.l1Misses += 1;
    this.logDebug(`L1 miss: ${key}`);

    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const pending = (async () => {
      const l2Value = await this.readL2<T>(key, ttl);
      if (l2Value !== null) {
        return l2Value;
      }

      const fresh = await fetcher();
      this.setL1(key, fresh, ttl);
      void this.writeL2(key, fresh, ttl);
      return fresh;
    })();

    this.inflight.set(key, pending as Promise<unknown>);
    try {
      return await pending;
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * Set cache directly
   */
  set<T>(key: string, data: T, ttl: number = 5 * 60 * 1000): void {
    this.setL1(key, data, ttl);
    void this.writeL2(key, data, ttl);
    void this.publishInvalidation('set', { key });
  }

  /**
   * Check if cache exists and is not expired (L1 only)
   */
  has(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) {
      return false;
    }

    if (this.isExpired(item)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a specific cache entry
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    this.inflight.delete(key);
    void this.deleteL2Key(key);
    void this.publishInvalidation('delete', { key });
    return deleted;
  }

  /**
   * Delete all cache entries matching a pattern
   */
  deletePattern(pattern: string): number {
    const deletedCount = this.deletePatternLocal(pattern);

    void this.deleteL2Pattern(pattern);
    void this.publishInvalidation('delete-pattern', { pattern });
    return deletedCount;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.clearLocal();
    void this.deleteL2Pattern('*');
    void this.publishInvalidation('clear');
  }

  /**
   * Clean up expired cache items
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, item] of this.cache.entries()) {
      if (!this.isExpired(item, now)) {
        continue;
      }
      this.cache.delete(key);
      cleanedCount += 1;
    }

    if (cleanedCount > 0) {
      this.logDebug(`L1 cleanup removed ${cleanedCount} expired entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    expired: number;
    totalMemorySize: number;
    l2Enabled: boolean;
    metrics: CacheMetricsSnapshot;
  } {
    const now = Date.now();
    let expired = 0;
    let totalMemorySize = 0;

    for (const [key, item] of this.cache.entries()) {
      totalMemorySize += key.length * 2 + JSON.stringify(item.data).length * 2;

      if (this.isExpired(item, now)) {
        expired += 1;
      }
    }

    return {
      size: this.cache.size,
      expired,
      totalMemorySize,
      l2Enabled: this.isServerRuntime() && this.redisL2Enabled,
      metrics: {
        ...this.metrics,
      },
    };
  }

  /**
   * Destroy the cache service
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clearLocal();
    if (this.redisSubscriber && this.redisSubscriber.isOpen) {
      void this.redisSubscriber.quit?.().catch(() => {
        // best effort shutdown
      });
    }
    this.redisSubscriber = null;
  }
}

// Export singleton instance
export const cacheService = CacheService.getInstance();

// Common cache key generators
export const CacheKeys = {
  userProfile: (userId: string) => `user:profile:${userId}`,
  userConversations: (userId: string, page: number = 0) =>
    `user:conversations:${userId}:${page}`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  conversationMessages: (conversationId: string, page: number = 0) =>
    `conversation:messages:${conversationId}:${page}`,
  providers: () => 'providers:active',
  serviceInstances: (providerId: string) => `service:instances:${providerId}`,
  apiKey: (serviceInstanceId: string) => `api:key:${serviceInstanceId}`,
  conversationByExternalId: (externalId: string) =>
    `conversation:external:${externalId}`,

  // App Executions cache keys (for one-off workflow and text generation tasks)
  // These are for history queries, suitable for longer cache times
  userExecutions: (userId: string, page: number = 0) =>
    `user:executions:${userId}:${page}`,
  execution: (executionId: string) => `execution:${executionId}`,
  // Note: Real-time subscription is not added for now, as execution records are mainly for history viewing. Can be added later if needed.
};
