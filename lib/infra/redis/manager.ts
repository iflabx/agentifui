import { createClient } from 'redis';

const REDIS_MANAGER_GLOBAL_KEY = '__agentifui_redis_manager__';
const REDIS_CLIENT_GLOBAL_KEY = '__agentifui_redis_client__';

export interface RedisSetOptions {
  ttlSeconds?: number;
  keepTtl?: boolean;
}

type RedisClient = ReturnType<typeof createClient>;

export class RedisManager {
  private keyPrefix: string;

  constructor(prefix?: string) {
    const normalizedPrefix =
      prefix || process.env.REDIS_PREFIX?.trim() || 'agentifui';
    this.keyPrefix = normalizedPrefix.replace(/:+$/g, '');
  }

  private ensureServerRuntime() {
    if (typeof window !== 'undefined') {
      throw new Error('Redis manager can only run in server runtime');
    }
  }

  private resolveRedisUrl(): string {
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

  private createRedisClient(): RedisClient {
    const client = createClient({
      url: this.resolveRedisUrl(),
      socket: {
        connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 5000),
      },
      pingInterval: Number(process.env.REDIS_PING_INTERVAL_MS || 10000),
    });

    client.on('error', error => {
      console.error('[RedisManager] client error:', error);
    });

    return client;
  }

  async getClient(): Promise<RedisClient> {
    this.ensureServerRuntime();
    const globalState = globalThis as unknown as Record<string, unknown>;

    let client = globalState[REDIS_CLIENT_GLOBAL_KEY] as
      | RedisClient
      | undefined;

    if (!client) {
      client = this.createRedisClient();
      globalState[REDIS_CLIENT_GLOBAL_KEY] = client;
    }

    if (!client.isOpen) {
      await client.connect();
    }

    return client;
  }

  withPrefix(key: string): string {
    const normalizedKey = key.trim().replace(/^:+|:+$/g, '');
    if (!normalizedKey) {
      throw new Error('Redis key cannot be empty');
    }

    return `${this.keyPrefix}:${normalizedKey}`;
  }

  buildKey(...parts: string[]): string {
    const normalized = parts
      .map(part => part.trim())
      .filter(Boolean)
      .join(':')
      .replace(/:+/g, ':')
      .replace(/^:+|:+$/g, '');

    if (!normalized) {
      throw new Error('Redis key parts cannot all be empty');
    }

    return this.withPrefix(normalized);
  }

  pattern(pattern: string): string {
    return this.withPrefix(pattern);
  }

  async ping(): Promise<string> {
    const client = await this.getClient();
    return client.ping();
  }

  async get(key: string): Promise<string | null> {
    const client = await this.getClient();
    return client.get(this.withPrefix(key));
  }

  async set(
    key: string,
    value: string,
    options: RedisSetOptions = {}
  ): Promise<void> {
    const client = await this.getClient();
    const prefixedKey = this.withPrefix(key);

    if (options.keepTtl) {
      await client.set(prefixedKey, value, { KEEPTTL: true });
      return;
    }

    if (options.ttlSeconds && options.ttlSeconds > 0) {
      await client.set(prefixedKey, value, { EX: options.ttlSeconds });
      return;
    }

    await client.set(prefixedKey, value);
  }

  async del(key: string): Promise<number> {
    const client = await this.getClient();
    return client.del(this.withPrefix(key));
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      throw new Error(
        `[RedisManager] Failed to parse JSON for key "${key}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async setJson<T>(
    key: string,
    value: T,
    options: RedisSetOptions = {}
  ): Promise<void> {
    await this.set(key, JSON.stringify(value), options);
  }

  async deletePattern(pattern: string): Promise<number> {
    const client = await this.getClient();
    const scanPattern = this.pattern(pattern);
    const toDelete: string[] = [];

    for await (const cursorValue of client.scanIterator({
      MATCH: scanPattern,
      COUNT: 100,
    })) {
      if (Array.isArray(cursorValue)) {
        toDelete.push(...cursorValue);
      } else if (typeof cursorValue === 'string') {
        toDelete.push(cursorValue);
      }
    }

    if (toDelete.length === 0) {
      return 0;
    }

    return client.del(toDelete);
  }

  async quit(): Promise<void> {
    const globalState = globalThis as unknown as Record<string, unknown>;
    const client = globalState[REDIS_CLIENT_GLOBAL_KEY] as
      | RedisClient
      | undefined;

    if (!client) {
      return;
    }

    if (client.isOpen) {
      await client.quit();
    }

    delete globalState[REDIS_CLIENT_GLOBAL_KEY];
  }
}

export function getRedisManager(): RedisManager {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[REDIS_MANAGER_GLOBAL_KEY] as
    | RedisManager
    | undefined;
  if (existing) {
    return existing;
  }

  const manager = new RedisManager();
  globalState[REDIS_MANAGER_GLOBAL_KEY] = manager;
  return manager;
}

export const redisManager = getRedisManager();
