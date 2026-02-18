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

export interface DifyProxyResilienceConfig {
  timeoutMs: number;
  circuitEnabled: boolean;
  failureThreshold: number;
  failureWindowMs: number;
  openDurationMs: number;
  halfOpenMaxInFlight: number;
  failureStatuses: number[];
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

export function getDifyProxyResilienceMetricsSnapshot(): DifyProxyResilienceMetrics {
  return { ...getMetricsStore() };
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
}

export async function fetchWithDifyProxyResilience(
  request: DifyProxyResilienceRequest
): Promise<DifyProxyResilienceResult> {
  const config = resolveConfig(request.configOverride);
  const now = request.now || Date.now;
  const state = getCircuitState(request.circuitKey);
  const metrics = getMetricsStore();

  metrics.requestsTotal += 1;

  if (config.circuitEnabled) {
    pruneFailures(state, now(), config.failureWindowMs);

    if (state.status === 'open') {
      const openedAt = state.openedAt || now();
      if (now() - openedAt < config.openDurationMs) {
        metrics.circuitOpenRejects += 1;
        return {
          ok: false,
          reason: 'circuit-open',
          elapsedMs: 0,
          circuitStatus: state.status,
          retryAfterSeconds: toRetryAfterSeconds(
            state.openedAt,
            now(),
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
      metrics.circuitOpenRejects += 1;
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
      metrics.upstreamFailureStatusCount += 1;
      markFailure(state, now(), config);
    } else {
      metrics.upstreamSuccessStatusCount += 1;
      if (config.circuitEnabled) {
        markSuccess(state);
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
      metrics.timeoutRejects += 1;
    } else if (reason === 'network-error') {
      metrics.networkRejects += 1;
    } else if (reason === 'client-abort') {
      metrics.clientAbortRejects += 1;
    }

    if (config.circuitEnabled) {
      if (reason === 'client-abort') {
        if (state.status === 'half-open') {
          state.halfOpenInFlight = Math.max(0, state.halfOpenInFlight - 1);
        }
      } else {
        markFailure(state, now(), config);
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
