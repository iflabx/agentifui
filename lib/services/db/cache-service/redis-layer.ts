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
  private redisSubscriber: RedisClientLike | null | undefined;
  private redisSubscriberInitPromise: Promise<void> | null = null;
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
    return this.isServerRuntime() && this.options.enabled;
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
    if (this.redisSubscriber && this.redisSubscriber.isOpen) {
      void this.redisSubscriber.quit?.().catch(() => {
        // best effort shutdown
      });
    }
    this.redisSubscriber = null;
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

  private async ensureInvalidationSubscriber(
    redis: RedisClientLike
  ): Promise<void> {
    if (!this.options.invalidationEnabled || !this.isServerRuntime()) {
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
          this.options.invalidationChannel,
          rawMessage => {
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

  private async getRedisClient(): Promise<RedisClientLike | null> {
    if (!this.isServerRuntime() || !this.options.enabled) {
      return null;
    }

    const redisUrl = resolveRedisUrl();
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
      const client = createRedisClient(redisUrl);
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
    return `${this.options.keyPrefix}:${normalized}`;
  }
}
