import type { SubscriptionConfig } from './contract';

const REGISTRY_STATE_KEY =
  '__agentifui_fastify_realtime_subscription_registry__';

interface RegistryEntry {
  id: string;
  key: string;
  config: SubscriptionConfig;
  createdAt: number;
}

interface RegistryState {
  entries: Map<string, RegistryEntry>;
}

function getRegistryState(): RegistryState {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[REGISTRY_STATE_KEY] as RegistryState | undefined;
  if (existing) {
    return existing;
  }

  const created: RegistryState = {
    entries: new Map<string, RegistryEntry>(),
  };
  globalState[REGISTRY_STATE_KEY] = created;
  return created;
}

function buildEntryId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function registerRealtimeSubscription(
  key: string,
  config: SubscriptionConfig
): () => void {
  const state = getRegistryState();
  const id = buildEntryId();
  state.entries.set(id, {
    id,
    key,
    config,
    createdAt: Date.now(),
  });

  let closed = false;
  return () => {
    if (closed) {
      return;
    }
    closed = true;
    state.entries.delete(id);
  };
}

export function getRealtimeSubscriptionStats(): {
  total: number;
  byTable: Record<string, number>;
  byEvent: Record<string, number>;
  oldestSubscription?: { key: string; age: number };
} {
  const state = getRegistryState();
  const stats = {
    total: state.entries.size,
    byTable: {} as Record<string, number>,
    byEvent: {} as Record<string, number>,
    oldestSubscription: undefined as { key: string; age: number } | undefined,
  };

  let oldestTimestamp = Date.now();
  let oldestKey = '';
  for (const entry of state.entries.values()) {
    const table = entry.config.table || '';
    const event = entry.config.event || '*';
    if (table) {
      stats.byTable[table] = (stats.byTable[table] || 0) + 1;
    }
    stats.byEvent[event] = (stats.byEvent[event] || 0) + 1;

    if (entry.createdAt < oldestTimestamp) {
      oldestTimestamp = entry.createdAt;
      oldestKey = entry.key;
    }
  }

  if (oldestKey) {
    stats.oldestSubscription = {
      key: oldestKey,
      age: Date.now() - oldestTimestamp,
    };
  }

  return stats;
}

export function listRealtimeSubscriptions(): Array<{
  key: string;
  table: string;
  event: string;
  filter?: string;
  handlerCount: number;
  age: number;
}> {
  const state = getRegistryState();
  const now = Date.now();
  return Array.from(state.entries.values()).map(entry => ({
    key: entry.key,
    table: entry.config.table,
    event: entry.config.event,
    ...(entry.config.filter ? { filter: entry.config.filter } : {}),
    handlerCount: 1,
    age: Math.max(0, now - entry.createdAt),
  }));
}
