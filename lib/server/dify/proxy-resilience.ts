import { resolveDifyProxyResilienceConfig } from './proxy-resilience/config';
import { fetchWithDifyProxyResilience } from './proxy-resilience/fetch';
import {
  getDifyProxySharedCircuitSnapshot,
  readSharedMetrics,
  resetSharedDifyProxyResilienceMetrics,
} from './proxy-resilience/shared';
import {
  getDifyProxyCircuitSnapshot,
  getDifyProxyResilienceMetricsSnapshot,
  resetLocalDifyProxyResilienceState,
} from './proxy-resilience/state';
import type {
  DifyProxyResilienceConfig,
  DifyProxyResilienceMetricsReport,
  DifyProxyResilienceRequest,
  DifyProxyResilienceResult,
} from './proxy-resilience/types';

export type {
  DifyProxyResilienceConfig,
  DifyProxyResilienceMetricsReport,
  DifyProxyResilienceRequest,
  DifyProxyResilienceResult,
} from './proxy-resilience/types';

export {
  fetchWithDifyProxyResilience,
  getDifyProxyCircuitSnapshot,
  getDifyProxyResilienceMetricsSnapshot,
  getDifyProxySharedCircuitSnapshot,
};

export async function getDifyProxyResilienceMetricsReport(): Promise<DifyProxyResilienceMetricsReport> {
  const config = resolveDifyProxyResilienceConfig();
  const local = getDifyProxyResilienceMetricsSnapshot();
  const shared = config.sharedMetricsEnabled ? await readSharedMetrics() : null;
  return {
    local,
    shared,
    sharedEnabled: config.sharedMetricsEnabled,
  };
}

export function resetDifyProxyResilienceState(): void {
  resetLocalDifyProxyResilienceState();

  void (async () => {
    const config = resolveDifyProxyResilienceConfig();
    await resetSharedDifyProxyResilienceMetrics(config);
  })();
}
