import { toSeconds } from './helpers';
import { createRedisClient, resolveRedisUrl } from './redis-runtime';
import type {
  CacheInvalidationMessage,
  CacheInvalidationOperation,
  CacheMetricsSnapshot,
  RedisClientLike,
} from './types';

interface CacheRedisLayerOptions {
  enabled: boolean;
  keyPrefix: string;
  invalidationEnabled: boolean;
  invalidationChannel: string;
  invalidationOrigin: string;
  debugLogs: boolean;
  onRemoteInvalidation: (message: CacheInvalidationMessage) => void;
}

export class CacheRedisLayer {
  private redisClient: RedisClientLike | null | undefined;
  private redisClientInitPromise: Promise<RedisClientLike | null> | null = null;
  private redisSubscriber: RedisClientLike | null | undefined;
  private redisSubscriberInitPromise: Promise<void> | null = null;
  private destroyed = false;
  private redisLoadWarned = false;
  private redisRuntimeWarned = false;
  private redisInvalidationWarned = false;
  private readonly metrics: Pick<
    CacheMetricsSnapshot,
    'l2Hits' | 'l2Misses' | 'l2ReadErrors' | 'l2WriteErrors'
  > = {
    l2Hits: 0,
    l2Misses: 0,
    l2ReadErrors: 0,
    l2WriteErrors: 0,
  };

  constructor(private readonly options: CacheRedisLayerOptions) {}

  isL2Enabled(): boolean {
    return !this.destroyed && this.isServerRuntime() && this.options.enabled;
  }

  getMetrics(): Pick<
    CacheMetricsSnapshot,
    'l2Hits' | 'l2Misses' | 'l2ReadErrors' | 'l2WriteErrors'
  > {
    return { ...this.metrics };
  }

  async read<T>(
    key: string,
    ttl: number,
    onHit: (value: T, ttl: number) => void
  ): Promise<T | null> {
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
      onHit(value, ttl);
      this.logDebug(`L2 hit: ${key}`);
      return value;
    } catch (error) {
      this.metrics.l2ReadErrors += 1;
      this.disableRedisL2AfterRuntimeFailure('L2 read', error);
      return null;
    }
  }

  async write<T>(key: string, data: T, ttl: number): Promise<void> {
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

  async deleteKey(key: string): Promise<void> {
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

  async deletePattern(pattern: string): Promise<void> {
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

  async publishInvalidation(
    operation: CacheInvalidationOperation,
    input: { key?: string; pattern?: string } = {}
  ): Promise<void> {
    if (!this.options.invalidationEnabled || !this.isServerRuntime()) {
      return;
    }

    const redis = await this.getRedisClient();
    if (!redis || typeof redis.publish !== 'function') {
      return;
    }

    try {
      await redis.publish(
        this.options.invalidationChannel,
        JSON.stringify({
          origin: this.options.invalidationOrigin,
          operation,
          ...input,
        } satisfies CacheInvalidationMessage)
      );
    } catch (error) {
      this.warnRedisInvalidationOnce('invalidation publish', error);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.closeRedisClients();
  }

  private closeRedisClients(): void {
    const clients = new Set([this.redisClient, this.redisSubscriber]);
    this.redisClient = null;
    this.redisSubscriber = null;
    for (const client of clients) {
      if (client?.isOpen) client.destroy();
    }
  }

  private isServerRuntime(): boolean {
    return typeof window === 'undefined';
  }

  private logDebug(message: string): void {
    if (!this.options.debugLogs) {
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
    if (!this.destroyed && !this.redisRuntimeWarned) {
      this.redisRuntimeWarned = true;
      console.warn(
        `[CacheService] Redis L2 disabled after ${operation} failure:`,
        error instanceof Error ? error.message : String(error)
      );
    }

    this.closeRedisClients();
  }

  private warnRedisInvalidationOnce(operation: string, error: unknown): void {
    if (this.destroyed || this.redisInvalidationWarned) {
      return;
    }

    this.redisInvalidationWarned = true;
    console.warn(
      `[CacheService] Redis invalidation disabled after ${operation} failure:`,
      error instanceof Error ? error.message : String(error)
    );
  }

  private async ensureInvalidationSubscriber(
    redis: RedisClientLike
  ): Promise<void> {
    if (
      !this.options.invalidationEnabled ||
      !this.isL2Enabled() ||
      this.redisClient !== redis
    ) {
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
        if (typeof subscriber.subscribe !== 'function') {
          if (subscriber.isOpen) subscriber.destroy();
          return;
        }
        this.redisSubscriber = subscriber;
        if (!subscriber.isOpen) {
          await subscriber.connect();
        }
        if (this.destroyed || this.redisClient !== redis) {
          if (subscriber.isOpen) subscriber.destroy();
          return;
        }

        await subscriber.subscribe(
          this.options.invalidationChannel,
          rawMessage => {
            if (this.destroyed || this.redisClient !== redis) return;
            try {
              const parsed = JSON.parse(rawMessage) as CacheInvalidationMessage;
              if (parsed.origin === this.options.invalidationOrigin) {
                return;
              }
              this.options.onRemoteInvalidation(parsed);
            } catch (error) {
              this.warnRedisInvalidationOnce(
                'invalidation payload parse',
                error
              );
            }
          }
        );
      } catch (error) {
        if (this.redisSubscriber?.isOpen) this.redisSubscriber.destroy();
        this.redisSubscriber = null;
        if (!this.destroyed && this.redisClient === redis) {
          this.warnRedisInvalidationOnce('invalidation subscribe', error);
        }
      }
    })();

    try {
      await this.redisSubscriberInitPromise;
    } finally {
      this.redisSubscriberInitPromise = null;
    }
  }

  private async getRedisClient(): Promise<RedisClientLike | null> {
    if (!this.isL2Enabled()) {
      return null;
    }

    const redisUrl = resolveRedisUrl();
    if (!redisUrl) {
      this.closeRedisClients();
      return null;
    }

    if (this.redisClientInitPromise) return this.redisClientInitPromise;
    if (this.redisClient === null) return null;
    if (this.redisClient?.isOpen) {
      void this.ensureInvalidationSubscriber(this.redisClient);
      return this.redisClient;
    }

    this.redisClientInitPromise = (async () => {
      try {
        const client = this.redisClient ?? createRedisClient(redisUrl);
        this.redisClient = client;
        if (!client.isOpen) {
          await client.connect();
        }
        if (this.destroyed) return null;
        void this.ensureInvalidationSubscriber(client);
        return client;
      } catch (error) {
        if (!this.destroyed) this.warnRedisLoadFailureOnce(error);
        this.closeRedisClients();
        return null;
      }
    })();

    try {
      return await this.redisClientInitPromise;
    } finally {
      this.redisClientInitPromise = null;
    }
  }

  private toRedisKey(key: string): string {
    const normalized = key.trim().replace(/^:+|:+$/g, '');
    return `${this.options.keyPrefix}:${normalized}`;
  }
}
