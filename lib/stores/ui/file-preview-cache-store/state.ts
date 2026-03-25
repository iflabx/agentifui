import type { StateCreator } from 'zustand';

import {
  DEFAULT_CONFIG,
  DEFAULT_STATS,
  calculateCacheSize,
  evictLRU,
  isExpired,
  shouldCache,
} from './helpers';
import type { CacheConfig, CacheEntry, FilePreviewCacheState } from './types';

export const createFilePreviewCacheState: StateCreator<
  FilePreviewCacheState,
  [],
  [],
  FilePreviewCacheState
> = (set, get) => ({
  runtimeCache: new Map(),
  config: DEFAULT_CONFIG,
  stats: DEFAULT_STATS,

  get: (key: string) => {
    const state = get();
    const entry = state.runtimeCache.get(key);

    if (!entry) {
      set(current => ({
        stats: { ...current.stats, missCount: current.stats.missCount + 1 },
      }));
      return null;
    }

    if (isExpired(entry.timestamp, state.config.ttlMs)) {
      state.runtimeCache.delete(key);
      set(current => ({
        stats: {
          ...current.stats,
          missCount: current.stats.missCount + 1,
          totalSize: current.stats.totalSize - entry.size,
        },
      }));
      return null;
    }

    entry.lastAccessed = Date.now();
    entry.accessCount += 1;

    set(current => ({
      stats: { ...current.stats, hitCount: current.stats.hitCount + 1 },
    }));

    return entry;
  },

  set: (key, content, headers) => {
    const state = get();
    const config = state.config;

    if (!shouldCache(content.size, config)) {
      return false;
    }

    const now = Date.now();
    const entry: CacheEntry = {
      content,
      headers,
      timestamp: now,
      size: content.size,
      accessCount: 1,
      lastAccessed: now,
    };

    const existing = state.runtimeCache.get(key);
    const sizeDelta = existing ? content.size - existing.size : content.size;

    state.runtimeCache.set(key, entry);

    let newTotalSize = state.stats.totalSize + sizeDelta;
    let evictedCount = 0;
    if (
      newTotalSize > config.maxSizeBytes ||
      state.runtimeCache.size > config.maxEntries
    ) {
      evictedCount = evictLRU(
        state.runtimeCache,
        config.maxSizeBytes * 0.8,
        config
      );
      newTotalSize = calculateCacheSize(state.runtimeCache);
    }

    set(current => ({
      stats: {
        ...current.stats,
        totalSize: newTotalSize,
        evictionCount: current.stats.evictionCount + evictedCount,
      },
    }));

    return true;
  },

  clear: () => {
    const state = get();
    state.runtimeCache.clear();
    set({
      stats: DEFAULT_STATS,
    });
  },

  cleanup: () => {
    const state = get();
    const config = state.config;
    let removedSize = 0;
    let removedCount = 0;

    for (const [key, entry] of state.runtimeCache.entries()) {
      if (isExpired(entry.timestamp, config.ttlMs)) {
        state.runtimeCache.delete(key);
        removedSize += entry.size;
        removedCount += 1;
      }
    }

    set(current => ({
      stats: {
        ...current.stats,
        totalSize: current.stats.totalSize - removedSize,
        evictionCount: current.stats.evictionCount + removedCount,
      },
    }));
  },

  getCacheStats: () => {
    const state = get();
    return {
      ...state.stats,
      entryCount: state.runtimeCache.size,
      hitRate:
        state.stats.hitCount / (state.stats.hitCount + state.stats.missCount) ||
        0,
    };
  },

  updateConfig: (newConfig: Partial<CacheConfig>) => {
    const state = get();
    const updatedConfig = { ...state.config, ...newConfig };

    set(() => ({
      config: updatedConfig,
    }));

    const currentState = get();
    if (
      currentState.runtimeCache.size > updatedConfig.maxEntries ||
      currentState.stats.totalSize > updatedConfig.maxSizeBytes
    ) {
      const evictedCount = evictLRU(
        currentState.runtimeCache,
        updatedConfig.maxSizeBytes * 0.8,
        updatedConfig
      );
      const newTotalSize = calculateCacheSize(currentState.runtimeCache);

      if (evictedCount > 0) {
        set(() => ({
          stats: {
            ...currentState.stats,
            totalSize: newTotalSize,
            evictionCount: currentState.stats.evictionCount + evictedCount,
          },
        }));
      }
    }
  },
});
