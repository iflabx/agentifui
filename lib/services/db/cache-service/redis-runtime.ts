import { toPositiveNumber } from './helpers';
import { RedisClientLike, RedisModule } from './types';

export function resolveRedisUrl(): string | null {
  const fromPrimary = process.env.REDIS_URL?.trim();
  if (fromPrimary) {
    return fromPrimary;
  }

  const host = process.env.REDIS_HOST?.trim();
  if (!host) {
    return null;
  }

  const port = process.env.REDIS_PORT?.trim() || '6379';
  const db = process.env.REDIS_DB?.trim() || '0';
  const password = process.env.REDIS_PASSWORD?.trim();

  if (password) {
    return `redis://:${encodeURIComponent(password)}@${host}:${port}/${db}`;
  }

  return `redis://${host}:${port}/${db}`;
}

export function createRedisClient(redisUrl: string): RedisClientLike {
  const runtimeRequire = eval('require') as (id: string) => unknown;
  const redisModule = runtimeRequire('redis') as RedisModule;
  const client = redisModule.createClient({
    url: redisUrl,
    socket: {
      connectTimeout: toPositiveNumber(
        process.env.REDIS_CONNECT_TIMEOUT_MS,
        5000
      ),
    },
    pingInterval: toPositiveNumber(process.env.REDIS_PING_INTERVAL_MS, 10000),
  });

  client.on('error', error => {
    console.error('[CacheService] Redis client error:', error);
  });

  return client;
}
