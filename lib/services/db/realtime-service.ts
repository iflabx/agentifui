/**
 * Unified real-time subscription management service.
 *
 * Runtime model:
 * - Browser: uses SSE (`/api/internal/realtime/stream`) for cross-process events.
 * - Server: in-memory dispatcher; cross-process fan-out is handled by
 *   `lib/server/realtime/bridge.ts`.
 */

export interface SubscriptionConfig {
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  schema: string;
  table: string;
  filter?: string;
}

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export type RealtimeRow = Record<string, unknown>;

export interface RealtimeDbChangePayload {
  schema: string;
  table: string;
  eventType: RealtimeEventType;
  commitTimestamp: string;
  new: RealtimeRow | null;
  old: RealtimeRow | null;
}

export interface RealtimeEnvelope {
  id: string;
  key: string;
  emittedAt: number;
  payload: RealtimeDbChangePayload;
}

interface ManagedSubscription {
  handlers: Set<(payload: unknown) => void>;
  config: SubscriptionConfig;
  createdAt: number;
}

function parseEqFilter(
  filter: string
): { field: string; value: string } | null {
  const normalized = filter.trim();
  const match = normalized.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=eq\.(.+)$/);
  if (!match) {
    return null;
  }

  return {
    field: match[1],
    value: match[2],
  };
}

function rowFieldToComparableString(
  row: RealtimeRow | null,
  field: string
): string | null {
  if (!row) {
    return null;
  }

  const value = row[field];
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

export function matchesSubscriptionConfig(
  config: SubscriptionConfig,
  payload: RealtimeDbChangePayload
): boolean {
  if (config.schema !== payload.schema || config.table !== payload.table) {
    return false;
  }

  if (config.event !== '*' && config.event !== payload.eventType) {
    return false;
  }

  if (!config.filter) {
    return true;
  }

  const parsedFilter = parseEqFilter(config.filter);
  if (!parsedFilter) {
    // Keep backward compatibility for unsupported filters:
    // do not block event delivery when parser cannot understand the filter.
    return true;
  }

  const { field, value } = parsedFilter;
  const candidates = [
    rowFieldToComparableString(payload.new, field),
    rowFieldToComparableString(payload.old, field),
  ];

  return candidates.includes(value);
}

function normalizeEnvelope(
  key: string,
  payload: unknown
): RealtimeEnvelope | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as Partial<RealtimeEnvelope>;
  if (
    candidate.payload &&
    typeof candidate.payload === 'object' &&
    typeof candidate.key === 'string'
  ) {
    const normalizedPayload = candidate.payload as RealtimeDbChangePayload;
    if (
      typeof normalizedPayload.schema === 'string' &&
      typeof normalizedPayload.table === 'string' &&
      typeof normalizedPayload.eventType === 'string'
    ) {
      return {
        id: String(candidate.id || ''),
        key: candidate.key,
        emittedAt:
          typeof candidate.emittedAt === 'number'
            ? candidate.emittedAt
            : Date.now(),
        payload: normalizedPayload,
      };
    }
  }

  const raw = candidate as Partial<RealtimeDbChangePayload>;
  if (
    typeof raw.schema === 'string' &&
    typeof raw.table === 'string' &&
    typeof raw.eventType === 'string'
  ) {
    return {
      id: '',
      key,
      emittedAt: Date.now(),
      payload: {
        schema: raw.schema,
        table: raw.table,
        eventType: raw.eventType as RealtimeEventType,
        commitTimestamp:
          typeof raw.commitTimestamp === 'string'
            ? raw.commitTimestamp
            : new Date().toISOString(),
        new: (raw.new as RealtimeRow | null) || null,
        old: (raw.old as RealtimeRow | null) || null,
      },
    };
  }

  return null;
}

function extractStringField(row: RealtimeRow | null, field: string): string {
  if (!row) {
    return '';
  }

  const value = row[field];
  if (value === null || value === undefined) {
    return '';
  }

  const normalized = String(value).trim();
  return normalized;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function deriveSubscriptionKeysForTableChange(input: {
  table: string;
  newRow: RealtimeRow | null;
  oldRow: RealtimeRow | null;
}): string[] {
  const table = input.table;
  const newRow = input.newRow;
  const oldRow = input.oldRow;

  if (table === 'profiles') {
    const profileId =
      extractStringField(newRow, 'id') || extractStringField(oldRow, 'id');
    if (!profileId) {
      return [];
    }
    return [SubscriptionKeys.userProfile(profileId)];
  }

  if (table === 'providers') {
    return [SubscriptionKeys.providers()];
  }

  if (table === 'service_instances') {
    return [SubscriptionKeys.serviceInstances()];
  }

  if (table === 'api_keys') {
    return [SubscriptionKeys.apiKeys()];
  }

  if (table === 'conversations') {
    const userId =
      extractStringField(newRow, 'user_id') ||
      extractStringField(oldRow, 'user_id');
    if (!userId) {
      return [];
    }

    return [
      SubscriptionKeys.sidebarConversations(userId),
      SubscriptionKeys.allConversations(userId),
      SubscriptionKeys.userConversations(userId),
    ];
  }

  if (table === 'messages') {
    const conversationId =
      extractStringField(newRow, 'conversation_id') ||
      extractStringField(oldRow, 'conversation_id');
    if (!conversationId) {
      return [];
    }

    return [SubscriptionKeys.conversationMessages(conversationId)];
  }

  return [];
}

function buildRealtimeSseUrl(key: string, config: SubscriptionConfig): string {
  const params = new URLSearchParams();
  params.set('key', key);
  params.set('schema', config.schema);
  params.set('table', config.table);
  params.set('event', config.event);
  if (config.filter) {
    params.set('filter', config.filter);
  }
  return `/api/internal/realtime/stream?${params.toString()}`;
}

export class RealtimeService {
  private static instance: RealtimeService;
  private subscriptions = new Map<string, ManagedSubscription>();
  private browserEventSources = new Map<string, EventSource>();

  private constructor() {}

  public static getInstance(): RealtimeService {
    if (!RealtimeService.instance) {
      RealtimeService.instance = new RealtimeService();
    }
    return RealtimeService.instance;
  }

  subscribe(
    key: string,
    config: SubscriptionConfig,
    handler: (payload: unknown) => void
  ): () => void {
    let subscription = this.subscriptions.get(key);

    if (subscription) {
      subscription.handlers.add(handler);
    } else {
      subscription = {
        handlers: new Set([handler]),
        config,
        createdAt: Date.now(),
      };
      this.subscriptions.set(key, subscription);

      if (typeof window !== 'undefined') {
        this.openBrowserEventSource(key, config);
      }
    }

    return () => {
      this.unsubscribeHandler(key, handler);
    };
  }

  private openBrowserEventSource(
    key: string,
    config: SubscriptionConfig
  ): void {
    if (this.browserEventSources.has(key)) {
      return;
    }

    try {
      const eventSource = new EventSource(buildRealtimeSseUrl(key, config), {
        withCredentials: true,
      });

      eventSource.onmessage = event => {
        try {
          const parsed = JSON.parse(event.data) as unknown;
          const envelope = normalizeEnvelope(key, parsed);
          if (!envelope) {
            return;
          }

          this.dispatchRealtimeEnvelope(key, envelope);
        } catch (error) {
          console.warn('[RealtimeService] Failed to parse SSE payload:', error);
        }
      };

      eventSource.onerror = error => {
        // EventSource has built-in reconnect; keep this log low-noise.
        console.warn('[RealtimeService] SSE stream error:', error);
      };

      this.browserEventSources.set(key, eventSource);
    } catch (error) {
      console.error('[RealtimeService] Failed to open SSE stream:', error);
    }
  }

  private closeBrowserEventSource(key: string): void {
    const source = this.browserEventSources.get(key);
    if (!source) {
      return;
    }

    source.close();
    this.browserEventSources.delete(key);
  }

  private unsubscribeHandler(
    key: string,
    handler: (payload: unknown) => void
  ): void {
    const subscription = this.subscriptions.get(key);
    if (!subscription) return;

    subscription.handlers.delete(handler);
    if (subscription.handlers.size === 0) {
      this.unsubscribe(key);
    }
  }

  unsubscribe(key: string): void {
    this.subscriptions.delete(key);
    if (typeof window !== 'undefined') {
      this.closeBrowserEventSource(key);
    }
  }

  unsubscribeAll(): void {
    this.subscriptions.clear();
    if (typeof window !== 'undefined') {
      for (const key of this.browserEventSources.keys()) {
        this.closeBrowserEventSource(key);
      }
    }
  }

  /**
   * Local dispatcher. Server-side bridge and publisher will call this.
   */
  emit(key: string, payload: unknown): void {
    const envelope = normalizeEnvelope(key, payload);
    if (!envelope) {
      return;
    }
    this.dispatchRealtimeEnvelope(key, envelope);
  }

  private dispatchRealtimeEnvelope(
    key: string,
    envelope: RealtimeEnvelope
  ): void {
    const subscription = this.subscriptions.get(key);
    if (!subscription) {
      return;
    }

    if (!matchesSubscriptionConfig(subscription.config, envelope.payload)) {
      return;
    }

    subscription.handlers.forEach(handler => {
      try {
        handler(envelope.payload);
      } catch (error) {
        console.error(
          '[Realtime Subscription] Handler execution error:',
          error
        );
      }
    });
  }

  getStats(): {
    total: number;
    byTable: Record<string, number>;
    byEvent: Record<string, number>;
    oldestSubscription?: { key: string; age: number };
  } {
    const stats = {
      total: this.subscriptions.size,
      byTable: {} as Record<string, number>,
      byEvent: {} as Record<string, number>,
      oldestSubscription: undefined as { key: string; age: number } | undefined,
    };

    let oldestTimestamp = Date.now();
    let oldestKey = '';

    for (const [key, subscription] of this.subscriptions.entries()) {
      const table = subscription.config.table;
      stats.byTable[table] = (stats.byTable[table] || 0) + 1;

      const event = subscription.config.event;
      stats.byEvent[event] = (stats.byEvent[event] || 0) + 1;

      if (subscription.createdAt < oldestTimestamp) {
        oldestTimestamp = subscription.createdAt;
        oldestKey = key;
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

  listSubscriptions(): Array<{
    key: string;
    table: string;
    event: string;
    filter?: string;
    handlerCount: number;
    age: number;
  }> {
    return Array.from(this.subscriptions.entries()).map(
      ([key, subscription]) => ({
        key,
        table: subscription.config.table,
        event: subscription.config.event,
        filter: subscription.config.filter,
        handlerCount: subscription.handlers.size,
        age: Date.now() - subscription.createdAt,
      })
    );
  }

  destroy(): void {
    this.unsubscribeAll();
  }
}

export const realtimeService = RealtimeService.getInstance();

export const SubscriptionKeys = {
  sidebarConversations: (userId: string) => `sidebar-conversations:${userId}`,
  allConversations: (userId: string) => `all-conversations:${userId}`,
  userConversations: (userId: string) => `user-conversations:${userId}`,
  conversationMessages: (conversationId: string) =>
    `conversation-messages:${conversationId}`,
  userProfile: (userId: string) => `user-profile:${userId}`,
  providers: () => 'providers',
  serviceInstances: () => 'service-instances',
  apiKeys: () => 'api-keys',
};

export const SubscriptionConfigs = {
  conversations: (userId?: string): SubscriptionConfig => ({
    event: '*',
    schema: 'public',
    table: 'conversations',
    ...(userId && { filter: `user_id=eq.${userId}` }),
  }),

  messages: (conversationId?: string): SubscriptionConfig => ({
    event: '*',
    schema: 'public',
    table: 'messages',
    ...(conversationId && { filter: `conversation_id=eq.${conversationId}` }),
  }),

  profiles: (userId?: string): SubscriptionConfig => ({
    event: 'UPDATE',
    schema: 'public',
    table: 'profiles',
    ...(userId && { filter: `id=eq.${userId}` }),
  }),

  providers: (): SubscriptionConfig => ({
    event: '*',
    schema: 'public',
    table: 'providers',
  }),

  serviceInstances: (): SubscriptionConfig => ({
    event: '*',
    schema: 'public',
    table: 'service_instances',
  }),
};

export function deriveRealtimeKeysForTableChange(input: {
  table: string;
  newRow: RealtimeRow | null;
  oldRow: RealtimeRow | null;
}): string[] {
  return unique(deriveSubscriptionKeysForTableChange(input));
}
