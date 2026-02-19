import { createClient } from 'redis';

import type { StorageNamespace } from './upload-policy';

type PresignRateLimitScope = 'upload' | 'download';

const REDIS_CLIENT_KEY =
  '__agentifui_fastify_storage_rate_limit_redis_client__';

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

function resolveRedisUrl(): string {
  const fromPrimary = process.env.REDIS_URL?.trim();
  if (fromPrimary) {
    return fromPrimary;
  }
  const host = process.env.REDIS_HOST?.trim();
  if (!host) {
    throw new Error('REDIS_URL (or REDIS_HOST) is required');
  }

  const port = process.env.REDIS_PORT?.trim() || '6379';
  const db = process.env.REDIS_DB?.trim() || '0';
  const password = process.env.REDIS_PASSWORD?.trim();
  if (password) {
    return `redis://:${encodeURIComponent(password)}@${host}:${port}/${db}`;
  }
  return `redis://${host}:${port}/${db}`;
}

function getRedisPrefix(): string {
  const prefix = process.env.REDIS_PREFIX?.trim() || 'agentifui';
  return prefix.replace(/:+$/g, '');
}

function buildKey(...parts: string[]): string {
  const normalized = parts
    .map(part => part.trim())
    .filter(Boolean)
    .join(':')
    .replace(/:+/g, ':')
    .replace(/^:+|:+$/g, '');
  return `${getRedisPrefix()}:${normalized}`;
}

async function getRedisClient() {
  const globalState = globalThis as unknown as Record<string, unknown>;
  let client = globalState[REDIS_CLIENT_KEY] as
    | ReturnType<typeof createClient>
    | undefined;
  if (!client) {
    client = createClient({
      url: resolveRedisUrl(),
      socket: {
        connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 5000),
      },
      pingInterval: Number(process.env.REDIS_PING_INTERVAL_MS || 10000),
    });
    client.on('error', error => {
      console.error('[FastifyStorageRateLimit] redis client error:', error);
    });
    globalState[REDIS_CLIENT_KEY] = client;
  }

  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

export async function enforceStoragePresignRateLimit(input: {
  actorUserId: string;
  namespace: StorageNamespace;
  scope: PresignRateLimitScope;
}): Promise<{ retryAfterSeconds: number } | null> {
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
    const key = buildKey(
      'rate-limit',
      'storage-presign',
      input.namespace,
      input.scope,
      actorUserId,
      String(slot)
    );
    const client = await getRedisClient();
    const current = await client.incr(key);
    if (current === 1) {
      await client.expire(key, windowSeconds + 1);
    }
    if (current <= limit) {
      return null;
    }

    return {
      retryAfterSeconds: windowSeconds,
    };
  } catch (error) {
    console.warn(
      '[FastifyStorageRateLimit] redis unavailable, fallback to allow:',
      error
    );
    return null;
  }
}
