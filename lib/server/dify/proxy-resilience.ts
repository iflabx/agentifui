import { redisManager } from '@lib/infra/redis';
import { createHash } from 'node:crypto';

type CircuitStatus = 'closed' | 'open' | 'half-open';

interface CircuitState {
  status: CircuitStatus;
  failures: number[];
  openedAt: number | null;
  halfOpenInFlight: number;
}

interface DifyProxyResilienceStateStore {
  circuits: Map<string, CircuitState>;
}

interface DifyProxyResilienceMetrics {
  requestsTotal: number;
  circuitOpenRejects: number;
  timeoutRejects: number;
  networkRejects: number;
  clientAbortRejects: number;
  upstreamFailureStatusCount: number;
  upstreamSuccessStatusCount: number;
}

type DifyProxyResilienceMetricKey = keyof DifyProxyResilienceMetrics;

interface DifyProxySharedCircuitSnapshot {
  redisEnabled: boolean;
  openUntilMs: number | null;
  isOpen: boolean;
  retryAfterSeconds: number;
}

export interface DifyProxyResilienceMetricsReport {
  local: DifyProxyResilienceMetrics;
  shared: Partial<DifyProxyResilienceMetrics> | null;
  sharedEnabled: boolean;
}

export interface DifyProxyResilienceConfig {
  timeoutMs: number;
  circuitEnabled: boolean;
  failureThreshold: number;
  failureWindowMs: number;
  openDurationMs: number;
  halfOpenMaxInFlight: number;
  failureStatuses: number[];
  sharedStateEnabled: boolean;
  sharedMetricsEnabled: boolean;
}

export interface DifyProxyResilienceRequest {
  circuitKey: string;
  execute: (signal: AbortSignal) => Promise<Response>;
  requestSignal?: AbortSignal;
  configOverride?: Partial<DifyProxyResilienceConfig>;
  now?: () => number;
}

type DifyProxyFailureReason =
  | 'circuit-open'
  | 'timeout'
  | 'network-error'
  | 'client-abort';

export type DifyProxyResilienceResult =
  | {
      ok: true;
      response: Response;
      elapsedMs: number;
      circuitStatus: CircuitStatus;
    }
  | {
      ok: false;
      reason: DifyProxyFailureReason;
      error?: Error;
      elapsedMs: number;
      circuitStatus: CircuitStatus;
      retryAfterSeconds?: number;
    };

const RESILIENCE_STATE_GLOBAL_KEY = '__agentifui_dify_proxy_resilience_state__';
const RESILIENCE_METRICS_GLOBAL_KEY =
  '__agentifui_dify_proxy_resilience_metrics__';
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

function getStateStore(): DifyProxyResilienceStateStore {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[
    RESILIENCE_STATE_GLOBAL_KEY
  ] as DifyProxyResilienceStateStore | null;
  if (existing?.circuits instanceof Map) {
    return existing;
  }

  const created: DifyProxyResilienceStateStore = {
    circuits: new Map<string, CircuitState>(),
  };
  globalState[RESILIENCE_STATE_GLOBAL_KEY] = created;
  return created;
}

function getMetricsStore(): DifyProxyResilienceMetrics {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[
    RESILIENCE_METRICS_GLOBAL_KEY
  ] as DifyProxyResilienceMetrics | null;
  if (existing) {
    return existing;
  }

  const created: DifyProxyResilienceMetrics = {
    requestsTotal: 0,
    circuitOpenRejects: 0,
    timeoutRejects: 0,
    networkRejects: 0,
    clientAbortRejects: 0,
    upstreamFailureStatusCount: 0,
    upstreamSuccessStatusCount: 0,
  };
  globalState[RESILIENCE_METRICS_GLOBAL_KEY] = created;
  return created;
}

function resolveConfig(
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

function pruneFailures(
  state: CircuitState,
  now: number,
  failureWindowMs: number
): void {
  const minTs = now - failureWindowMs;
  state.failures = state.failures.filter(ts => ts >= minTs);
}

function getCircuitState(circuitKey: string): CircuitState {
  const stateStore = getStateStore();
  const existing = stateStore.circuits.get(circuitKey);
  if (existing) {
    return existing;
  }

  const created: CircuitState = {
    status: 'closed',
    failures: [],
    openedAt: null,
    halfOpenInFlight: 0,
  };
  stateStore.circuits.set(circuitKey, created);
  return created;
}

function markSuccess(state: CircuitState): void {
  if (state.status === 'half-open') {
    state.status = 'closed';
    state.failures = [];
    state.openedAt = null;
    state.halfOpenInFlight = 0;
  }
}

function markFailure(
  state: CircuitState,
  now: number,
  config: DifyProxyResilienceConfig
): void {
  if (state.status === 'half-open') {
    state.status = 'open';
    state.openedAt = now;
    state.failures = [now];
    state.halfOpenInFlight = 0;
    return;
  }

  state.failures.push(now);
  pruneFailures(state, now, config.failureWindowMs);
  if (state.failures.length >= config.failureThreshold) {
    state.status = 'open';
    state.openedAt = now;
    state.halfOpenInFlight = 0;
  }
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
}

function toRetryAfterSeconds(
  openedAt: number | null,
  now: number,
  openDurationMs: number
): number | undefined {
  if (!openedAt) {
    return undefined;
  }

  const leftMs = openedAt + openDurationMs - now;
  if (leftMs <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(leftMs / 1000));
}

function shouldCountFailureStatus(
  status: number,
  failureStatuses: number[]
): boolean {
  if (failureStatuses.includes(status)) {
    return true;
  }
  return status >= 500;
}

function bumpMetric(
  metrics: DifyProxyResilienceMetrics,
  key: DifyProxyResilienceMetricKey,
  config: DifyProxyResilienceConfig
): void {
  metrics[key] += 1;
  if (config.sharedMetricsEnabled) {
    void incrementSharedMetric(key);
  }
}

async function incrementSharedMetric(
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

async function readSharedMetrics(): Promise<Partial<DifyProxyResilienceMetrics> | null> {
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

async function readSharedCircuitOpenUntilMs(
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

async function setSharedCircuitOpen(
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

async function clearSharedCircuitOpen(
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
  const config = resolveConfig();
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

export function getDifyProxyResilienceMetricsSnapshot(): DifyProxyResilienceMetrics {
  return { ...getMetricsStore() };
}

export async function getDifyProxyResilienceMetricsReport(): Promise<DifyProxyResilienceMetricsReport> {
  const config = resolveConfig();
  const local = getDifyProxyResilienceMetricsSnapshot();
  const shared = config.sharedMetricsEnabled ? await readSharedMetrics() : null;
  return {
    local,
    shared,
    sharedEnabled: config.sharedMetricsEnabled,
  };
}

export function getDifyProxyCircuitSnapshot(circuitKey: string): {
  status: CircuitStatus;
  failureCount: number;
  openedAt: number | null;
  halfOpenInFlight: number;
} {
  const state = getCircuitState(circuitKey);
  return {
    status: state.status,
    failureCount: state.failures.length,
    openedAt: state.openedAt,
    halfOpenInFlight: state.halfOpenInFlight,
  };
}

export function resetDifyProxyResilienceState(): void {
  const stateStore = getStateStore();
  stateStore.circuits.clear();

  const metrics = getMetricsStore();
  metrics.requestsTotal = 0;
  metrics.circuitOpenRejects = 0;
  metrics.timeoutRejects = 0;
  metrics.networkRejects = 0;
  metrics.clientAbortRejects = 0;
  metrics.upstreamFailureStatusCount = 0;
  metrics.upstreamSuccessStatusCount = 0;

  void (async () => {
    const config = resolveConfig();
    if (!config.sharedMetricsEnabled) {
      return;
    }
    try {
      await redisManager.del(DIFY_PROXY_METRICS_KEY);
    } catch {
      // best-effort reset for shared metrics
    }
  })();
}

export async function fetchWithDifyProxyResilience(
  request: DifyProxyResilienceRequest
): Promise<DifyProxyResilienceResult> {
  const config = resolveConfig(request.configOverride);
  const now = request.now || Date.now;
  const state = getCircuitState(request.circuitKey);
  const metrics = getMetricsStore();

  bumpMetric(metrics, 'requestsTotal', config);

  if (config.circuitEnabled) {
    const checkTs = now();
    pruneFailures(state, checkTs, config.failureWindowMs);

    const sharedOpenUntil = await readSharedCircuitOpenUntilMs(
      request.circuitKey,
      config
    );
    if (sharedOpenUntil && sharedOpenUntil > checkTs) {
      bumpMetric(metrics, 'circuitOpenRejects', config);
      return {
        ok: false,
        reason: 'circuit-open',
        elapsedMs: 0,
        circuitStatus: 'open',
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((sharedOpenUntil - checkTs) / 1000)
        ),
      };
    }

    if (state.status === 'open') {
      const openedAt = state.openedAt || checkTs;
      if (checkTs - openedAt < config.openDurationMs) {
        bumpMetric(metrics, 'circuitOpenRejects', config);
        return {
          ok: false,
          reason: 'circuit-open',
          elapsedMs: 0,
          circuitStatus: state.status,
          retryAfterSeconds: toRetryAfterSeconds(
            state.openedAt,
            checkTs,
            config.openDurationMs
          ),
        };
      }

      state.status = 'half-open';
      state.halfOpenInFlight = 0;
    }

    if (
      state.status === 'half-open' &&
      state.halfOpenInFlight >= config.halfOpenMaxInFlight
    ) {
      bumpMetric(metrics, 'circuitOpenRejects', config);
      return {
        ok: false,
        reason: 'circuit-open',
        elapsedMs: 0,
        circuitStatus: state.status,
        retryAfterSeconds: 1,
      };
    }

    if (state.status === 'half-open') {
      state.halfOpenInFlight += 1;
    }
  }

  const controller = new AbortController();
  const startedAt = now();
  let timeoutFired = false;
  let requestAbortListener: (() => void) | null = null;

  const timeoutId = setTimeout(() => {
    timeoutFired = true;
    controller.abort(new Error('dify_proxy_timeout'));
  }, config.timeoutMs);

  if (request.requestSignal) {
    requestAbortListener = () => {
      controller.abort(new Error('dify_proxy_client_abort'));
    };
    request.requestSignal.addEventListener('abort', requestAbortListener, {
      once: true,
    });
  }

  try {
    const response = await request.execute(controller.signal);
    const elapsedMs = Math.max(0, now() - startedAt);

    if (
      config.circuitEnabled &&
      shouldCountFailureStatus(response.status, config.failureStatuses)
    ) {
      bumpMetric(metrics, 'upstreamFailureStatusCount', config);
      const beforeStatus = state.status;
      const failureTs = now();
      markFailure(state, failureTs, config);
      if (state.status === 'open' && beforeStatus !== 'open') {
        await setSharedCircuitOpen(request.circuitKey, failureTs, config);
      }
    } else {
      bumpMetric(metrics, 'upstreamSuccessStatusCount', config);
      if (config.circuitEnabled) {
        const wasHalfOpen = state.status === 'half-open';
        markSuccess(state);
        if (wasHalfOpen && state.status === 'closed') {
          await clearSharedCircuitOpen(request.circuitKey, config);
        }
      }
    }

    if (state.status === 'half-open') {
      state.halfOpenInFlight = Math.max(0, state.halfOpenInFlight - 1);
    }

    return {
      ok: true,
      response,
      elapsedMs,
      circuitStatus: state.status,
    };
  } catch (error) {
    const elapsedMs = Math.max(0, now() - startedAt);
    const clientAborted = request.requestSignal?.aborted === true;
    const reason: DifyProxyFailureReason = clientAborted
      ? 'client-abort'
      : timeoutFired
        ? 'timeout'
        : 'network-error';

    if (reason === 'timeout') {
      bumpMetric(metrics, 'timeoutRejects', config);
    } else if (reason === 'network-error') {
      bumpMetric(metrics, 'networkRejects', config);
    } else if (reason === 'client-abort') {
      bumpMetric(metrics, 'clientAbortRejects', config);
    }

    if (config.circuitEnabled) {
      if (reason === 'client-abort') {
        if (state.status === 'half-open') {
          state.halfOpenInFlight = Math.max(0, state.halfOpenInFlight - 1);
        }
      } else {
        const beforeStatus = state.status;
        const failureTs = now();
        markFailure(state, failureTs, config);
        if (state.status === 'open' && beforeStatus !== 'open') {
          await setSharedCircuitOpen(request.circuitKey, failureTs, config);
        }
      }
    }

    return {
      ok: false,
      reason,
      error: toError(error),
      elapsedMs,
      circuitStatus: state.status,
      retryAfterSeconds: toRetryAfterSeconds(
        state.openedAt,
        now(),
        config.openDurationMs
      ),
    };
  } finally {
    clearTimeout(timeoutId);
    if (request.requestSignal && requestAbortListener) {
      request.requestSignal.removeEventListener('abort', requestAbortListener);
    }
  }
}
