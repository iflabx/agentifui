import type { Conversation, Message } from '../../types/database';

export const IS_BROWSER = typeof window !== 'undefined';

export type RealtimeRow = Record<string, unknown>;
export type ConversationCreateInput = Omit<
  Conversation,
  'id' | 'created_at' | 'updated_at'
>;
export type ConversationUpdateInput = Partial<
  Omit<Conversation, 'id' | 'created_at' | 'updated_at'>
>;
export type MessageCreateInput = Omit<Message, 'id' | 'created_at'>;
