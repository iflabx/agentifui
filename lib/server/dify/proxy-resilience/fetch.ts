import { resolveDifyProxyResilienceConfig } from './config';
import {
  clearSharedCircuitOpen,
  incrementSharedMetric,
  readSharedCircuitOpenUntilMs,
  setSharedCircuitOpen,
} from './shared';
import {
  getCircuitState,
  getMetricsStore,
  markFailure,
  markSuccess,
  pruneFailures,
} from './state';
import type {
  CircuitState,
  DifyProxyFailureReason,
  DifyProxyResilienceConfig,
  DifyProxyResilienceMetricKey,
  DifyProxyResilienceMetrics,
  DifyProxyResilienceRequest,
  DifyProxyResilienceResult,
} from './types';

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

function rejectCircuitOpen(input: {
  metrics: DifyProxyResilienceMetrics;
  config: DifyProxyResilienceConfig;
  circuitStatus: CircuitState['status'];
  retryAfterSeconds?: number;
}): DifyProxyResilienceResult {
  bumpMetric(input.metrics, 'circuitOpenRejects', input.config);
  return {
    ok: false,
    reason: 'circuit-open',
    elapsedMs: 0,
    circuitStatus: input.circuitStatus,
    retryAfterSeconds: input.retryAfterSeconds,
  };
}

export async function fetchWithDifyProxyResilience(
  request: DifyProxyResilienceRequest
): Promise<DifyProxyResilienceResult> {
  const config = resolveDifyProxyResilienceConfig(request.configOverride);
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
      return rejectCircuitOpen({
        metrics,
        config,
        circuitStatus: 'open',
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((sharedOpenUntil - checkTs) / 1000)
        ),
      });
    }

    if (state.status === 'open') {
      const openedAt = state.openedAt || checkTs;
      if (checkTs - openedAt < config.openDurationMs) {
        return rejectCircuitOpen({
          metrics,
          config,
          circuitStatus: state.status,
          retryAfterSeconds: toRetryAfterSeconds(
            state.openedAt,
            checkTs,
            config.openDurationMs
          ),
        });
      }

      state.status = 'half-open';
      state.halfOpenInFlight = 0;
    }

    if (
      state.status === 'half-open' &&
      state.halfOpenInFlight >= config.halfOpenMaxInFlight
    ) {
      return rejectCircuitOpen({
        metrics,
        config,
        circuitStatus: state.status,
        retryAfterSeconds: 1,
      });
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
