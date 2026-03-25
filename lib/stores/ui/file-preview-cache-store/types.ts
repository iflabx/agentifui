import type { DifyFilePreviewResponse } from '@lib/services/dify/types';

export interface CacheEntry {
  content: Blob;
  headers: DifyFilePreviewResponse['headers'];
  timestamp: number;
  size: number;
  accessCount: number;
  lastAccessed: number;
}

export interface CacheConfig {
  maxSizeBytes: number;
  ttlMs: number;
  maxEntries: number;
  maxFileSizeBytes: number;
}

export interface CacheStats {
  totalSize: number;
  hitCount: number;
  missCount: number;
  evictionCount: number;
}

export interface FilePreviewCacheState {
  runtimeCache: Map<string, CacheEntry>;
  config: CacheConfig;
  stats: CacheStats;
  get: (key: string) => CacheEntry | null;
  set: (
    key: string,
    content: Blob,
    headers: DifyFilePreviewResponse['headers']
  ) => boolean;
  clear: () => void;
  cleanup: () => void;
  getCacheStats: () => {
    totalSize: number;
    hitCount: number;
    missCount: number;
    evictionCount: number;
    entryCount: number;
    hitRate: number;
  };
  updateConfig: (newConfig: Partial<CacheConfig>) => void;
}
