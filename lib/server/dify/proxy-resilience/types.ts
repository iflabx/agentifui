export type CircuitStatus = 'closed' | 'open' | 'half-open';

export interface CircuitState {
  status: CircuitStatus;
  failures: number[];
  openedAt: number | null;
  halfOpenInFlight: number;
}

export interface DifyProxyResilienceStateStore {
  circuits: Map<string, CircuitState>;
}

export interface DifyProxyResilienceMetrics {
  requestsTotal: number;
  circuitOpenRejects: number;
  timeoutRejects: number;
  networkRejects: number;
  clientAbortRejects: number;
  upstreamFailureStatusCount: number;
  upstreamSuccessStatusCount: number;
}

export type DifyProxyResilienceMetricKey = keyof DifyProxyResilienceMetrics;

export interface DifyProxySharedCircuitSnapshot {
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

export type DifyProxyFailureReason =
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
