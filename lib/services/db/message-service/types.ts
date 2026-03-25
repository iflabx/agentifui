import { Message, MessageStatus } from '@lib/types/database';

export type RealtimeRow = Record<string, unknown>;

export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
  nextCursor?: string;
  totalCount?: number;
}

export interface PaginationCursor {
  timestamp: string;
  id: string;
}

export interface SaveMessageInput {
  conversation_id: string;
  user_id?: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  status?: MessageStatus;
  external_id?: string | null;
  token_count?: number | null;
  sequence_index?: number;
}
