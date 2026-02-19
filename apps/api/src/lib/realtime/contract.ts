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
  origin?: string;
  payload: RealtimeDbChangePayload;
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
    return false;
  }

  const candidates = [
    rowFieldToComparableString(payload.new, parsedFilter.field),
    rowFieldToComparableString(payload.old, parsedFilter.field),
  ];
  return candidates.includes(parsedFilter.value);
}

function extractStringField(row: RealtimeRow | null, field: string): string {
  if (!row) {
    return '';
  }
  const value = row[field];
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

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
    ...(userId ? { filter: `user_id=eq.${userId}` } : {}),
  }),

  messages: (conversationId?: string): SubscriptionConfig => ({
    event: '*',
    schema: 'public',
    table: 'messages',
    ...(conversationId
      ? { filter: `conversation_id=eq.${conversationId}` }
      : {}),
  }),

  profiles: (userId?: string): SubscriptionConfig => ({
    event: 'UPDATE',
    schema: 'public',
    table: 'profiles',
    ...(userId ? { filter: `id=eq.${userId}` } : {}),
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
    return unique([
      SubscriptionKeys.sidebarConversations(userId),
      SubscriptionKeys.allConversations(userId),
      SubscriptionKeys.userConversations(userId),
    ]);
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
