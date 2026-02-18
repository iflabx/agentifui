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

interface RedisSetOptions {
  ttlSeconds?: number;
  keepTtl?: boolean;
}

interface RedisCacheManager {
  getJson<T>(key: string): Promise<T | null>;
  setJson<T>(key: string, value: T, options?: RedisSetOptions): Promise<void>;
  del(key: string): Promise<number>;
  deletePattern(pattern: string): Promise<number>;
}

type RedisManagerModule = {
  getRedisManager?: () => RedisCacheManager;
  redisManager?: RedisCacheManager;
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

function escapeRegexPattern(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

export class CacheService {
  private static instance: CacheService;
  private cache = new Map<string, CacheItem<unknown>>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private inflight = new Map<string, Promise<unknown>>();
  private redisManager: RedisCacheManager | null | undefined;
  private redisLoadWarned = false;
  private redisRuntimeWarned = false;

  private readonly redisL2Enabled: boolean;
  private readonly redisKeyPrefix: string;
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
    this.redisManager = null;
  }

  private getRedisManager(): RedisCacheManager | null {
    if (!this.isServerRuntime() || !this.redisL2Enabled) {
      return null;
    }

    const hasRedisConfig = Boolean(
      process.env.REDIS_URL?.trim() || process.env.REDIS_HOST?.trim()
    );
    if (!hasRedisConfig) {
      this.redisManager = null;
      return null;
    }

    if (this.redisManager !== undefined) {
      return this.redisManager;
    }

    try {
      // Dynamic require prevents browser bundle from resolving node-only deps.
      const runtimeRequire = eval('require') as (id: string) => unknown;
      const redisModule = runtimeRequire(
        '../../infra/redis/manager'
      ) as RedisManagerModule;
      const manager =
        typeof redisModule.getRedisManager === 'function'
          ? redisModule.getRedisManager()
          : redisModule.redisManager;

      if (!manager) {
        throw new Error('Redis manager export is unavailable');
      }

      this.redisManager = manager;
      return manager;
    } catch (error) {
      this.warnRedisLoadFailureOnce(error);
      this.redisManager = null;
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
    const redis = this.getRedisManager();
    if (!redis) {
      return null;
    }

    try {
      const value = await redis.getJson<T>(this.toRedisKey(key));
      if (value === null) {
        this.metrics.l2Misses += 1;
        this.logDebug(`L2 miss: ${key}`);
        return null;
      }

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
    const redis = this.getRedisManager();
    if (!redis) {
      return;
    }

    try {
      await redis.setJson(this.toRedisKey(key), data, {
        ttlSeconds: toSeconds(ttl),
      });
      this.logDebug(`L2 write: ${key}`);
    } catch (error) {
      this.metrics.l2WriteErrors += 1;
      this.disableRedisL2AfterRuntimeFailure('L2 write', error);
    }
  }

  private async deleteL2Key(key: string): Promise<void> {
    const redis = this.getRedisManager();
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
    const redis = this.getRedisManager();
    if (!redis) {
      return;
    }

    try {
      await redis.deletePattern(this.toRedisKey(pattern));
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
    void this.deleteL2Key(key);
    return deleted;
  }

  /**
   * Delete all cache entries matching a pattern
   */
  deletePattern(pattern: string): number {
    let deletedCount = 0;
    const regex = new RegExp(
      `^${escapeRegexPattern(pattern).replace(/\*/g, '.*')}$`
    );

    for (const key of this.cache.keys()) {
      if (!regex.test(key)) {
        continue;
      }
      this.cache.delete(key);
      deletedCount += 1;
    }

    void this.deleteL2Pattern(pattern);
    return deletedCount;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.inflight.clear();
    void this.deleteL2Pattern('*');
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
    this.cache.clear();
    this.inflight.clear();
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
