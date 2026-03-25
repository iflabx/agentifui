import { escapeRegexPattern } from './helpers';
import type {
  CacheInvalidationMessage,
  CacheItem,
  CacheMetricsSnapshot,
} from './types';

export class CacheLocalStore {
  private cache = new Map<string, CacheItem<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  private l1Hits = 0;
  private l1Misses = 0;

  read<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) {
      this.l1Misses += 1;
      return null;
    }

    if (this.isExpired(item)) {
      this.cache.delete(key);
      this.l1Misses += 1;
      return null;
    }

    this.l1Hits += 1;
    return item.data as T;
  }

  set<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

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

  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    this.inflight.delete(key);
    return deleted;
  }

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
      this.inflight.delete(key);
      deletedCount += 1;
    }

    return deletedCount;
  }

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  applyRemoteInvalidation(message: CacheInvalidationMessage): void {
    if (message.operation === 'clear') {
      this.clear();
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
      this.deletePattern(message.pattern);
    }
  }

  getInflight<T>(key: string): Promise<T> | undefined {
    return this.inflight.get(key) as Promise<T> | undefined;
  }

  trackInflight<T>(key: string, pending: Promise<T>): void {
    this.inflight.set(key, pending as Promise<unknown>);
  }

  clearInflight(key: string): void {
    this.inflight.delete(key);
  }

  cleanupExpired(): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, item] of this.cache.entries()) {
      if (!this.isExpired(item, now)) {
        continue;
      }

      this.cache.delete(key);
      cleanedCount += 1;
    }

    return cleanedCount;
  }

  getMetrics(): Pick<CacheMetricsSnapshot, 'l1Hits' | 'l1Misses'> {
    return {
      l1Hits: this.l1Hits,
      l1Misses: this.l1Misses,
    };
  }

  getStatsSnapshot(): {
    size: number;
    expired: number;
    totalMemorySize: number;
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
    };
  }

  private isExpired(item: CacheItem<unknown>, now = Date.now()): boolean {
    return now - item.timestamp >= item.ttl;
  }
}
