/**
 * Unified real-time subscription management service.
 *
 * Supabase realtime has been removed from the migration path.
 * This service keeps the same API as a no-op/local dispatcher so callers
 * do not break while we migrate to Redis-backed pub/sub later.
 */

export interface SubscriptionConfig {
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  schema: string;
  table: string;
  filter?: string;
}

interface ManagedSubscription {
  handlers: Set<(payload: unknown) => void>;
  config: SubscriptionConfig;
  createdAt: number;
}

export class RealtimeService {
  private static instance: RealtimeService;
  private subscriptions = new Map<string, ManagedSubscription>();

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
    }

    return () => {
      this.unsubscribeHandler(key, handler);
    };
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
  }

  unsubscribeAll(): void {
    this.subscriptions.clear();
  }

  /**
   * Optional local trigger helper for tests/mocked flows.
   */
  emit(key: string, payload: unknown): void {
    const subscription = this.subscriptions.get(key);
    if (!subscription) {
      return;
    }

    subscription.handlers.forEach(handler => {
      try {
        handler(payload);
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
