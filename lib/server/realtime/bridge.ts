import { realtimeService } from '@lib/services/db/realtime-service';

import { subscribeRealtimeEvents } from './redis-broker';

const BRIDGE_STATE_KEY = '__agentifui_realtime_bridge__';

type BridgeState = {
  started: boolean;
  startPromise: Promise<void> | null;
};

function getBridgeState(): BridgeState {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[BRIDGE_STATE_KEY] as BridgeState | undefined;
  if (existing) {
    return existing;
  }

  const created: BridgeState = {
    started: false,
    startPromise: null,
  };
  globalState[BRIDGE_STATE_KEY] = created;
  return created;
}

/**
 * Server-side bridge: Redis Pub/Sub -> in-process realtime dispatcher.
 * This should be called by server code paths that register subscriptions.
 */
export function ensureRealtimeBridge(): void {
  if (typeof window !== 'undefined') {
    return;
  }

  const state = getBridgeState();
  if (state.started || state.startPromise) {
    return;
  }

  state.startPromise = (async () => {
    await subscribeRealtimeEvents(event => {
      realtimeService.emit(event.key, event.payload);
    });
    state.started = true;
  })()
    .catch(error => {
      console.warn('[RealtimeBridge] failed to start:', error);
    })
    .finally(() => {
      state.startPromise = null;
    });
}
