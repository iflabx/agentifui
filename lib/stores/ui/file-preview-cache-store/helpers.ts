import type { CacheConfig, CacheEntry, CacheStats } from './types';

export const DEFAULT_CONFIG: CacheConfig = {
  maxSizeBytes: 50 * 1024 * 1024,
  ttlMs: 30 * 60 * 1000,
  maxEntries: 100,
  maxFileSizeBytes: 20 * 1024 * 1024,
};

export const DEFAULT_STATS: CacheStats = {
  totalSize: 0,
  hitCount: 0,
  missCount: 0,
  evictionCount: 0,
};

export function isExpired(timestamp: number, ttl: number): boolean {
  return Date.now() - timestamp > ttl;
}

export function shouldCache(size: number, config: CacheConfig): boolean {
  return size <= config.maxFileSizeBytes;
}

export function calculateCacheSize(cache: Map<string, CacheEntry>): number {
  return Array.from(cache.values()).reduce((sum, entry) => sum + entry.size, 0);
}

export function evictLRU(
  cache: Map<string, CacheEntry>,
  targetSize: number,
  config: CacheConfig
): number {
  let evictedCount = 0;
  let currentSize = calculateCacheSize(cache);

  const sortedEntries = Array.from(cache.entries()).sort(
    ([, a], [, b]) => a.lastAccessed - b.lastAccessed
  );

  for (const [key, entry] of sortedEntries) {
    if (currentSize <= targetSize && cache.size <= config.maxEntries) {
      break;
    }

    cache.delete(key);
    currentSize -= entry.size;
    evictedCount += 1;
  }

  return evictedCount;
}

export function getCacheKey(appId: string, fileId: string): string {
  return `preview:${appId}:${fileId}`;
}
