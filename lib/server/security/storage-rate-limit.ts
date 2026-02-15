import { redisManager } from '@lib/infra/redis';
import type { StorageNamespace } from '@lib/shared/storage-upload-policy';

import { NextResponse } from 'next/server';

type PresignRateLimitScope = 'upload' | 'download';

function parsePositiveInt(value: string | undefined, fallbackValue: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.floor(parsed);
}

function resolveWindowSeconds() {
  return parsePositiveInt(process.env.STORAGE_PRESIGN_RATE_WINDOW_SECONDS, 60);
}

function resolveRateLimit(scope: PresignRateLimitScope) {
  const common = parsePositiveInt(process.env.STORAGE_PRESIGN_RATE_LIMIT, 300);
  const scopeOverride =
    scope === 'upload'
      ? parsePositiveInt(process.env.STORAGE_PRESIGN_UPLOAD_RATE_LIMIT, common)
      : parsePositiveInt(
          process.env.STORAGE_PRESIGN_DOWNLOAD_RATE_LIMIT,
          common
        );

  return scopeOverride;
}

export async function enforceStoragePresignRateLimit(input: {
  actorUserId: string;
  namespace: StorageNamespace;
  scope: PresignRateLimitScope;
}): Promise<NextResponse | null> {
  const actorUserId = input.actorUserId.trim();
  if (!actorUserId) {
    return null;
  }

  const windowSeconds = resolveWindowSeconds();
  const limit = resolveRateLimit(input.scope);
  if (windowSeconds <= 0 || limit <= 0) {
    return null;
  }

  try {
    const slot = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = redisManager.buildKey(
      'rate-limit',
      'storage-presign',
      input.namespace,
      input.scope,
      actorUserId,
      String(slot)
    );
    const client = await redisManager.getClient();
    const current = await client.incr(key);
    if (current === 1) {
      await client.expire(key, windowSeconds + 1);
    }

    if (current <= limit) {
      return null;
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Too many storage presign requests, please retry later',
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(windowSeconds),
        },
      }
    );
  } catch (error) {
    console.warn(
      '[StorageRateLimit] Redis unavailable, fallback to allow:',
      error
    );
    return null;
  }
}
