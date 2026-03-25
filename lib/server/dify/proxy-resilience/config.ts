import type { DifyProxyResilienceConfig } from './types';

function parseBoolean(
  rawValue: string | undefined,
  fallback: boolean
): boolean {
  if (!rawValue) {
    return fallback;
  }
  const normalized = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parsePositiveInt(
  rawValue: string | undefined,
  fallback: number,
  minimum: number
): number {
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number(rawValue.trim());
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseFailureStatuses(rawValue: string | undefined): number[] {
  if (!rawValue || rawValue.trim().length === 0) {
    return [429, 500, 502, 503, 504];
  }

  const unique = new Set<number>();
  for (const item of rawValue.split(',')) {
    const parsed = Number(item.trim());
    if (!Number.isInteger(parsed) || parsed < 100 || parsed > 599) {
      continue;
    }
    unique.add(parsed);
  }

  if (unique.size === 0) {
    return [429, 500, 502, 503, 504];
  }

  return Array.from(unique.values()).sort((a, b) => a - b);
}

function hasRedisConfigured(): boolean {
  return Boolean(
    process.env.REDIS_URL?.trim() || process.env.REDIS_HOST?.trim()
  );
}

export function resolveDifyProxyResilienceConfig(
  override: Partial<DifyProxyResilienceConfig> = {}
): DifyProxyResilienceConfig {
  const redisConfigured = hasRedisConfigured();
  return {
    timeoutMs: parsePositiveInt(process.env.DIFY_PROXY_TIMEOUT_MS, 30000, 1000),
    circuitEnabled: parseBoolean(process.env.DIFY_PROXY_CIRCUIT_ENABLED, true),
    failureThreshold: parsePositiveInt(
      process.env.DIFY_PROXY_CIRCUIT_FAILURE_THRESHOLD,
      5,
      1
    ),
    failureWindowMs: parsePositiveInt(
      process.env.DIFY_PROXY_CIRCUIT_FAILURE_WINDOW_MS,
      30000,
      1000
    ),
    openDurationMs: parsePositiveInt(
      process.env.DIFY_PROXY_CIRCUIT_OPEN_DURATION_MS,
      30000,
      1000
    ),
    halfOpenMaxInFlight: parsePositiveInt(
      process.env.DIFY_PROXY_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT,
      1,
      1
    ),
    failureStatuses: parseFailureStatuses(
      process.env.DIFY_PROXY_CIRCUIT_FAILURE_STATUSES
    ),
    sharedStateEnabled: parseBoolean(
      process.env.DIFY_PROXY_CIRCUIT_SHARED_STATE_ENABLED,
      redisConfigured
    ),
    sharedMetricsEnabled: parseBoolean(
      process.env.DIFY_PROXY_CIRCUIT_SHARED_METRICS_ENABLED,
      redisConfigured
    ),
    ...override,
  };
}
