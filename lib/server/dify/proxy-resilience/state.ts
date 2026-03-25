import type {
  CircuitState,
  DifyProxyResilienceConfig,
  DifyProxyResilienceMetrics,
  DifyProxyResilienceStateStore,
} from './types';

const RESILIENCE_STATE_GLOBAL_KEY = '__agentifui_dify_proxy_resilience_state__';
const RESILIENCE_METRICS_GLOBAL_KEY =
  '__agentifui_dify_proxy_resilience_metrics__';

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

export function getMetricsStore(): DifyProxyResilienceMetrics {
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

export function getDifyProxyResilienceMetricsSnapshot(): DifyProxyResilienceMetrics {
  return { ...getMetricsStore() };
}

export function pruneFailures(
  state: CircuitState,
  now: number,
  failureWindowMs: number
): void {
  const minTs = now - failureWindowMs;
  state.failures = state.failures.filter(ts => ts >= minTs);
}

export function getCircuitState(circuitKey: string): CircuitState {
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

export function markSuccess(state: CircuitState): void {
  if (state.status === 'half-open') {
    state.status = 'closed';
    state.failures = [];
    state.openedAt = null;
    state.halfOpenInFlight = 0;
  }
}

export function markFailure(
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

export function getDifyProxyCircuitSnapshot(circuitKey: string): {
  status: CircuitState['status'];
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

export function resetLocalDifyProxyResilienceState(): void {
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
