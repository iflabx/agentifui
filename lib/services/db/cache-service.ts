/**
 * Unified cache service
 *
 * L1: in-process cache
 * L2 (optional, server runtime only): Redis
 */
import {
  parseBooleanEnv,
  resolveInvalidationOrigin,
} from './cache-service/helpers';
import { CacheLocalStore } from './cache-service/local-store';
import { CacheRedisLayer } from './cache-service/redis-layer';
import { type CacheMetricsSnapshot } from './cache-service/types';

export { CacheKeys } from './cache-service/keys';

export class CacheService {
  private static instance: CacheService;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly localStore = new CacheLocalStore();
  private readonly redisLayer: CacheRedisLayer;

  private readonly debugLogs: boolean;

  private constructor() {
    const redisL2Enabled = parseBooleanEnv(
      process.env.CACHE_L2_REDIS_ENABLED,
      true
    );
    const redisKeyPrefix = (
      process.env.CACHE_L2_KEY_PREFIX?.trim() || 'cache:l2'
    ).replace(/:+$/g, '');
    this.debugLogs = parseBooleanEnv(process.env.CACHE_DEBUG_LOGS, false);
    const redisInvalidationEnabled =
      redisL2Enabled &&
      parseBooleanEnv(process.env.CACHE_L2_REDIS_INVALIDATION_ENABLED, true);
    const redisInvalidationChannel =
      process.env.CACHE_L2_INVALIDATION_CHANNEL?.trim() ||
      `${redisKeyPrefix}:invalidate`;
    const invalidationOrigin = resolveInvalidationOrigin();

    this.redisLayer = new CacheRedisLayer({
      enabled: redisL2Enabled,
      keyPrefix: redisKeyPrefix,
      invalidationEnabled: redisInvalidationEnabled,
      invalidationChannel: redisInvalidationChannel,
      invalidationOrigin,
      debugLogs: this.debugLogs,
      onRemoteInvalidation: message => {
        this.localStore.applyRemoteInvalidation(message);
      },
    });

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, 60000);
  }

  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  private logDebug(message: string): void {
    if (!this.debugLogs) {
      return;
    }

    console.log(`[CacheService] ${message}`);
  }

  async get<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 5 * 60 * 1000
  ): Promise<T> {
    const l1Value = this.localStore.read<T>(key);
    if (l1Value !== null) {
      this.logDebug(`L1 hit: ${key}`);
      return l1Value;
    }

    this.logDebug(`L1 miss: ${key}`);

    const existing = this.localStore.getInflight<T>(key);
    if (existing) {
      return existing;
    }

    const pending = (async () => {
      const l2Value = await this.redisLayer.read<T>(
        key,
        ttl,
        (value, valueTtl) => {
          this.localStore.set(key, value, valueTtl);
        }
      );
      if (l2Value !== null) {
        return l2Value;
      }

      const fresh = await fetcher();
      this.localStore.set(key, fresh, ttl);
      void this.redisLayer.write(key, fresh, ttl);
      return fresh;
    })();

    this.localStore.trackInflight(key, pending);
    try {
      return await pending;
    } finally {
      this.localStore.clearInflight(key);
    }
  }

  set<T>(key: string, data: T, ttl: number = 5 * 60 * 1000): void {
    this.localStore.set(key, data, ttl);
    void this.redisLayer.write(key, data, ttl);
    void this.redisLayer.publishInvalidation('set', { key });
  }

  has(key: string): boolean {
    return this.localStore.has(key);
  }

  delete(key: string): boolean {
    const deleted = this.localStore.delete(key);
    void this.redisLayer.deleteKey(key);
    void this.redisLayer.publishInvalidation('delete', { key });
    return deleted;
  }

  deletePattern(pattern: string): number {
    const deletedCount = this.localStore.deletePattern(pattern);
    void this.redisLayer.deletePattern(pattern);
    void this.redisLayer.publishInvalidation('delete-pattern', { pattern });
    return deletedCount;
  }

  clear(): void {
    this.localStore.clear();
    void this.redisLayer.deletePattern('*');
    void this.redisLayer.publishInvalidation('clear');
  }

  private cleanupExpired(): void {
    const cleanedCount = this.localStore.cleanupExpired();
    if (cleanedCount > 0) {
      this.logDebug(`L1 cleanup removed ${cleanedCount} expired entries`);
    }
  }

  getStats(): {
    size: number;
    expired: number;
    totalMemorySize: number;
    l2Enabled: boolean;
    metrics: CacheMetricsSnapshot;
  } {
    const snapshot = this.localStore.getStatsSnapshot();
    return {
      ...snapshot,
      l2Enabled: this.redisLayer.isL2Enabled(),
      metrics: {
        ...this.localStore.getMetrics(),
        ...this.redisLayer.getMetrics(),
      },
    };
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.localStore.clear();
    this.redisLayer.destroy();
  }
}

export const cacheService = CacheService.getInstance();
