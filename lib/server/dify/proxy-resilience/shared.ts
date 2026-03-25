import { redisManager } from '@lib/infra/redis';
import { createHash } from 'node:crypto';

import { resolveDifyProxyResilienceConfig } from './config';
import type {
  DifyProxyResilienceConfig,
  DifyProxyResilienceMetricKey,
  DifyProxyResilienceMetrics,
  DifyProxySharedCircuitSnapshot,
} from './types';

const DIFY_PROXY_CIRCUIT_KEY_PREFIX = 'dify:proxy:circuit';
const DIFY_PROXY_METRICS_KEY = 'dify:proxy:metrics';
const SHARED_METRIC_KEYS: DifyProxyResilienceMetricKey[] = [
  'requestsTotal',
  'circuitOpenRejects',
  'timeoutRejects',
  'networkRejects',
  'clientAbortRejects',
  'upstreamFailureStatusCount',
  'upstreamSuccessStatusCount',
];

let sharedRedisWarned = false;

function hashCircuitKey(circuitKey: string): string {
  return createHash('sha1').update(circuitKey).digest('hex');
}

function toSharedCircuitRedisKey(circuitKey: string): string {
  return `${DIFY_PROXY_CIRCUIT_KEY_PREFIX}:${hashCircuitKey(circuitKey)}`;
}

function warnSharedRedisOnce(operation: string, error: unknown): void {
  if (sharedRedisWarned) {
    return;
  }
  sharedRedisWarned = true;
  console.warn(
    `[DifyProxyResilience] shared redis disabled for ${operation}:`,
    error instanceof Error ? error.message : String(error)
  );
}

export async function incrementSharedMetric(
  key: DifyProxyResilienceMetricKey
): Promise<void> {
  try {
    const client = await redisManager.getClient();
    const metricsKey = redisManager.buildKey(DIFY_PROXY_METRICS_KEY);
    await client.hIncrBy(metricsKey, key, 1);
    await client.hSet(metricsKey, {
      updatedAt: String(Date.now()),
    });
  } catch (error) {
    warnSharedRedisOnce('metrics increment', error);
  }
}

function parseSharedMetricValue(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

export async function readSharedMetrics(): Promise<Partial<DifyProxyResilienceMetrics> | null> {
  try {
    const client = await redisManager.getClient();
    const metricsKey = redisManager.buildKey(DIFY_PROXY_METRICS_KEY);
    const entries = await client.hGetAll(metricsKey);
    if (!entries || Object.keys(entries).length === 0) {
      return null;
    }
    const snapshot: Partial<DifyProxyResilienceMetrics> = {};
    for (const key of SHARED_METRIC_KEYS) {
      const parsed = parseSharedMetricValue(entries[key]);
      if (parsed > 0) {
        snapshot[key] = parsed;
      }
    }
    return snapshot;
  } catch (error) {
    warnSharedRedisOnce('metrics read', error);
    return null;
  }
}

export async function readSharedCircuitOpenUntilMs(
  circuitKey: string,
  config: DifyProxyResilienceConfig
): Promise<number | null> {
  if (!config.sharedStateEnabled) {
    return null;
  }
  try {
    const raw = await redisManager.get(toSharedCircuitRedisKey(circuitKey));
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.floor(parsed);
  } catch (error) {
    warnSharedRedisOnce('circuit read', error);
    return null;
  }
}

export async function setSharedCircuitOpen(
  circuitKey: string,
  openedAt: number,
  config: DifyProxyResilienceConfig
): Promise<void> {
  if (!config.sharedStateEnabled) {
    return;
  }
  const openUntil = openedAt + config.openDurationMs;
  try {
    await redisManager.set(
      toSharedCircuitRedisKey(circuitKey),
      String(openUntil),
      {
        ttlSeconds: Math.max(1, Math.ceil(config.openDurationMs / 1000)),
      }
    );
  } catch (error) {
    warnSharedRedisOnce('circuit write', error);
  }
}

export async function clearSharedCircuitOpen(
  circuitKey: string,
  config: DifyProxyResilienceConfig
): Promise<void> {
  if (!config.sharedStateEnabled) {
    return;
  }
  try {
    await redisManager.del(toSharedCircuitRedisKey(circuitKey));
  } catch (error) {
    warnSharedRedisOnce('circuit clear', error);
  }
}

export async function getDifyProxySharedCircuitSnapshot(
  circuitKey: string
): Promise<DifyProxySharedCircuitSnapshot> {
  const config = resolveDifyProxyResilienceConfig();
  const openUntilMs = await readSharedCircuitOpenUntilMs(circuitKey, config);
  const now = Date.now();
  return {
    redisEnabled: config.sharedStateEnabled,
    openUntilMs,
    isOpen: openUntilMs !== null && openUntilMs > now,
    retryAfterSeconds:
      openUntilMs !== null && openUntilMs > now
        ? Math.max(1, Math.ceil((openUntilMs - now) / 1000))
        : 0,
  };
}

export async function resetSharedDifyProxyResilienceMetrics(
  config: DifyProxyResilienceConfig
): Promise<void> {
  if (!config.sharedMetricsEnabled) {
    return;
  }
  try {
    await redisManager.del(DIFY_PROXY_METRICS_KEY);
  } catch {
    // best-effort reset for shared metrics
  }
}
