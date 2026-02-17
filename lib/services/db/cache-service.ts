/**
 * Unified cache service
 *
 * Provides in-memory data caching with TTL (time-to-live) management.
 * Used to reduce database query frequency and improve application performance.
 */

interface CacheItem<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class CacheService {
  private static instance: CacheService;
  private cache = new Map<string, CacheItem<unknown>>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor() {
    // Clean up expired cache items every minute
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
    const cached = this.cache.get(key);

    // Check if cache exists and is not expired
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      console.log(`[Cache hit] Key: ${key}`);
      return cached.data as T;
    }

    // Cache not found or expired, fetch new data
    console.log(`[Cache miss] Key: ${key}, fetching new data`);
    const data = await fetcher();

    // Store in cache
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });

    return data;
  }

  /**
   * Set cache directly
   */
  set<T>(key: string, data: T, ttl: number = 5 * 60 * 1000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Check if cache exists and is not expired
   */
  has(key: string): boolean {
    const cached = this.cache.get(key);
    if (!cached) return false;

    if (Date.now() - cached.timestamp >= cached.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a specific cache entry
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Delete all cache entries matching a pattern
   */
  deletePattern(pattern: string): number {
    let deletedCount = 0;
    const regex = new RegExp(pattern.replace('*', '.*'));

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Clean up expired cache items
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp >= item.ttl) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(
        `[Cache cleanup] Cleaned ${cleanedCount} expired cache items`
      );
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    expired: number;
    totalMemorySize: number;
  } {
    const now = Date.now();
    let expired = 0;
    let totalMemorySize = 0;

    for (const [key, item] of this.cache.entries()) {
      // Roughly estimate memory size
      totalMemorySize += key.length * 2 + JSON.stringify(item.data).length * 2;

      if (now - item.timestamp >= item.ttl) {
        expired++;
      }
    }

    return {
      size: this.cache.size,
      expired,
      totalMemorySize,
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
