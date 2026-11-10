import { redisManager } from '@lib/infra/redis';
import type { SecondaryStorage } from 'better-auth';

const SECONDARY_STORAGE_PREFIX = 'better-auth:secondary';

function normalizeStorageKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) {
    throw new Error('[better-auth] secondary storage key cannot be empty');
  }

  return `${SECONDARY_STORAGE_PREFIX}:${normalized}`;
}

function normalizeTtl(ttl: number | undefined): number | null {
  if (!Number.isFinite(ttl)) {
    return null;
  }

  const normalized = Math.floor(Number(ttl));
  if (normalized <= 0) {
    return null;
  }

  return normalized;
}

export function createBetterAuthSecondaryStorage(): SecondaryStorage {
  return {
    async get(key: string) {
      const storageKey = normalizeStorageKey(key);
      return redisManager.get(storageKey);
    },
    async getAndDelete(key: string) {
      return redisManager.getAndDelete(normalizeStorageKey(key));
    },
    async increment(key: string, ttl: number) {
      return redisManager.increment(normalizeStorageKey(key), ttl);
    },
    async set(key: string, value: string, ttl?: number) {
      const storageKey = normalizeStorageKey(key);
      const ttlSeconds = normalizeTtl(ttl);

      if (ttlSeconds) {
        await redisManager.set(storageKey, value, { ttlSeconds });
        return;
      }

      await redisManager.set(storageKey, value);
    },
    async delete(key: string) {
      const storageKey = normalizeStorageKey(key);
      await redisManager.del(storageKey);
    },
  };
}
