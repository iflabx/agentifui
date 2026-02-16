import { ensureRealtimeBridge } from './bridge';
import { publishTableChangeEvent } from './publisher';

const REALTIME_BRIDGE_ENSURER_GLOBAL_KEY =
  '__agentifui_realtime_bridge_ensurer__';
const REALTIME_PUBLISHER_GLOBAL_KEY = '__agentifui_realtime_publisher__';

type RealtimeRuntimeRegistryState = Record<string, unknown> & {
  [REALTIME_BRIDGE_ENSURER_GLOBAL_KEY]?: () => void;
  [REALTIME_PUBLISHER_GLOBAL_KEY]?: typeof publishTableChangeEvent;
};

export function registerRealtimeRuntimeRegistry(): void {
  if (typeof window !== 'undefined') {
    return;
  }

  const globalState = globalThis as unknown as RealtimeRuntimeRegistryState;
  globalState[REALTIME_BRIDGE_ENSURER_GLOBAL_KEY] = ensureRealtimeBridge;
  globalState[REALTIME_PUBLISHER_GLOBAL_KEY] = publishTableChangeEvent;
}

registerRealtimeRuntimeRegistry();
