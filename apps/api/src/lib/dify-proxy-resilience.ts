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
  'circuit-open' | 'timeout' | 'network-error' | 'client-abort';

export class DifyProxyRequestError extends Error {
  constructor(
    public readonly reason: Exclude<DifyProxyFailureReason, 'circuit-open'>,
    options?: ErrorOptions
  ) {
    super(`dify_proxy_${reason}`, options);
    this.name = 'DifyProxyRequestError';
  }
}

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

const RESILIENCE_STATE_GLOBAL_KEY =
  '__agentifui_fastify_dify_proxy_resilience_state__';
const RESILIENCE_METRICS_GLOBAL_KEY =
  '__agentifui_fastify_dify_proxy_resilience_metrics__';

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

function bumpMetric(
  metrics: DifyProxyResilienceMetrics,
  key: DifyProxyResilienceMetricKey
): void {
  metrics[key] += 1;
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

export async function fetchWithDifyProxyResilience(
  request: DifyProxyResilienceRequest
): Promise<DifyProxyResilienceResult> {
  const config = resolveConfig(request.configOverride);
  const now = request.now || Date.now;
  const state = getCircuitState(request.circuitKey);
  const metrics = getMetricsStore();

  bumpMetric(metrics, 'requestsTotal');

  if (config.circuitEnabled) {
    const checkTs = now();
    pruneFailures(state, checkTs, config.failureWindowMs);

    if (state.status === 'open') {
      const openedAt = state.openedAt || checkTs;
      if (checkTs - openedAt < config.openDurationMs) {
        bumpMetric(metrics, 'circuitOpenRejects');
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
      bumpMetric(metrics, 'circuitOpenRejects');
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
  let finished = false;
  let timeoutId: ReturnType<typeof setTimeout>;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let requestError: DifyProxyRequestError | undefined;
  let rejectAborted!: (error: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });

  const cleanup = () => {
    clearTimeout(timeoutId);
    request.requestSignal?.removeEventListener('abort', onClientAbort);
    if (state.status === 'half-open') {
      state.halfOpenInFlight = Math.max(0, state.halfOpenInFlight - 1);
    }
  };
  const fail = (reason: DifyProxyRequestError['reason'], cause?: unknown) => {
    if (finished) return;
    finished = true;
    requestError = new DifyProxyRequestError(reason, { cause });
    cleanup();
    controller.abort(requestError);
    rejectAborted(requestError);
    bodyController?.error(requestError);
    void reader?.cancel(requestError).catch(() => undefined);
    bumpMetric(
      metrics,
      reason === 'timeout'
        ? 'timeoutRejects'
        : reason === 'client-abort'
          ? 'clientAbortRejects'
          : 'networkRejects'
    );
    if (config.circuitEnabled && reason !== 'client-abort') {
      markFailure(state, now(), config);
    }
  };
  const onClientAbort = () => fail('client-abort');
  const armTimeout = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fail('timeout'), config.timeoutMs);
  };
  const complete = (response: Response) => {
    if (finished) return;
    finished = true;
    cleanup();
    if (
      config.circuitEnabled &&
      shouldCountFailureStatus(response.status, config.failureStatuses)
    ) {
      bumpMetric(metrics, 'upstreamFailureStatusCount');
      const failureTs = now();
      markFailure(state, failureTs, config);
    } else {
      bumpMetric(metrics, 'upstreamSuccessStatusCount');
      if (config.circuitEnabled) {
        markSuccess(state);
      }
    }
  };

  request.requestSignal?.addEventListener('abort', onClientAbort, {
    once: true,
  });
  armTimeout();
  if (request.requestSignal?.aborted) onClientAbort();

  try {
    const response = await Promise.race([
      controller.signal.aborted
        ? Promise.reject(requestError)
        : request.execute(controller.signal),
      aborted,
    ]);
    let guardedResponse = response;
    if (!response.body) {
      complete(response);
    } else {
      const eventStream =
        response.headers
          .get('content-type')
          ?.toLowerCase()
          .includes('text/event-stream') === true;
      if (eventStream) armTimeout();
      reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          bodyController = streamController;
        },
        async pull(streamController) {
          try {
            const chunk = await reader!.read();
            if (finished) return;
            if (chunk.done) {
              complete(response);
              reader!.releaseLock();
              streamController.close();
            } else {
              if (eventStream) armTimeout();
              streamController.enqueue(chunk.value);
            }
          } catch (error) {
            fail('network-error', error);
          }
        },
        cancel(reason) {
          fail('client-abort', reason);
        },
      });
      guardedResponse = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return {
      ok: true,
      response: guardedResponse,
      elapsedMs: Math.max(0, now() - startedAt),
      circuitStatus: state.status,
    };
  } catch (error) {
    fail('network-error', error);
    return {
      ok: false,
      reason: requestError!.reason,
      error: requestError || toError(error),
      elapsedMs: Math.max(0, now() - startedAt),
      circuitStatus: state.status,
      retryAfterSeconds: toRetryAfterSeconds(
        state.openedAt,
        now(),
        config.openDurationMs
      ),
    };
  }
}
