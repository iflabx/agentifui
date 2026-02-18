/** @jest-environment node */
import {
  type DifyProxyResilienceConfig,
  fetchWithDifyProxyResilience,
  getDifyProxyCircuitSnapshot,
  getDifyProxyResilienceMetricsSnapshot,
  resetDifyProxyResilienceState,
} from './proxy-resilience';

function resolveConfigOverride(
  override: Partial<DifyProxyResilienceConfig> = {}
): Partial<DifyProxyResilienceConfig> {
  return {
    timeoutMs: 100,
    circuitEnabled: true,
    failureThreshold: 2,
    failureWindowMs: 5000,
    openDurationMs: 200,
    halfOpenMaxInFlight: 1,
    failureStatuses: [503, 504],
    sharedStateEnabled: false,
    sharedMetricsEnabled: false,
    ...override,
  };
}

describe('dify proxy resilience', () => {
  beforeEach(() => {
    resetDifyProxyResilienceState();
  });

  it('times out slow upstream calls', async () => {
    const result = await fetchWithDifyProxyResilience({
      circuitKey: 'timeout-case',
      configOverride: resolveConfigOverride({
        timeoutMs: 20,
      }),
      execute: signal =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve(new Response('ok', { status: 200 }));
          }, 80);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            },
            { once: true }
          );
        }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected timeout failure');
    }

    expect(result.reason).toBe('timeout');
    const metrics = getDifyProxyResilienceMetricsSnapshot();
    expect(metrics.timeoutRejects).toBe(1);
  });

  it('opens circuit after configured upstream failures', async () => {
    const circuitKey = 'open-after-failures';
    const override = resolveConfigOverride({
      failureThreshold: 2,
      openDurationMs: 1000,
    });

    await fetchWithDifyProxyResilience({
      circuitKey,
      configOverride: override,
      execute: async () => new Response('fail-1', { status: 503 }),
    });

    await fetchWithDifyProxyResilience({
      circuitKey,
      configOverride: override,
      execute: async () => new Response('fail-2', { status: 503 }),
    });

    const blocked = await fetchWithDifyProxyResilience({
      circuitKey,
      configOverride: override,
      execute: async () => new Response('should-not-run', { status: 200 }),
    });

    expect(blocked.ok).toBe(false);
    if (blocked.ok) {
      throw new Error('expected circuit-open failure');
    }
    expect(blocked.reason).toBe('circuit-open');
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);

    const circuit = getDifyProxyCircuitSnapshot(circuitKey);
    expect(circuit.status).toBe('open');
  });

  it('transitions to half-open and closes after successful probe', async () => {
    const circuitKey = 'half-open-then-close';
    const override = resolveConfigOverride({
      failureThreshold: 1,
      openDurationMs: 100,
    });

    await fetchWithDifyProxyResilience({
      circuitKey,
      configOverride: override,
      execute: async () => new Response('fail', { status: 503 }),
    });

    await new Promise(resolve => setTimeout(resolve, 130));

    const probe = await fetchWithDifyProxyResilience({
      circuitKey,
      configOverride: override,
      execute: async () => new Response('ok', { status: 200 }),
    });

    expect(probe.ok).toBe(true);
    const circuit = getDifyProxyCircuitSnapshot(circuitKey);
    expect(circuit.status).toBe('closed');
    expect(circuit.failureCount).toBe(0);
  });
});
