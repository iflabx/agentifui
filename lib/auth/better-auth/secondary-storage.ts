import { redisManager } from '@lib/infra/redis';

const SECONDARY_STORAGE_PREFIX = 'better-auth:secondary';

type BetterAuthSecondaryStorage = {
  get: (key: string) => Promise<unknown>;
  set: (
    key: string,
    value: string,
    ttl?: number
  ) => Promise<void | null | unknown>;
  delete: (key: string) => Promise<void | null | string>;
};

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

export function createBetterAuthSecondaryStorage(): BetterAuthSecondaryStorage {
  return {
    async get(key: string) {
      const storageKey = normalizeStorageKey(key);
      return redisManager.get(storageKey);
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
