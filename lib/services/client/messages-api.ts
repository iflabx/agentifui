import { callInternalDataAction } from '@lib/db/internal-data-api';
import type { Message, MessageStatus } from '@lib/types/database';
import type { Result } from '@lib/types/result';

export type MessageSavePayload = {
  conversation_id: string;
  user_id?: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  status?: MessageStatus;
  external_id?: string | null;
  token_count?: number | null;
  sequence_index?: number;
};

export function getLatestMessages(
  conversationId: string,
  limit: number
): Promise<Result<Message[]>> {
  return callInternalDataAction<Message[]>('messages.getLatest', {
    conversationId,
    limit,
  });
}

export type ConversationMessagePage = {
  messages: Message[];
  hasMore: boolean;
  nextCursor: string | null;
};

export interface HistoryMessageIdentity {
  id: string;
  conversationId: string;
  title: string | null;
  role: 'user' | 'assistant';
}

export interface HistoryMessagePage {
  hits: Array<HistoryMessageIdentity & { snippet: string }>;
  nextCursor: string | null;
}

export interface HistoryMessageMatch extends HistoryMessageIdentity {
  content: string;
  externalId: string | null;
  appId: string | null;
  agent: boolean;
}

export function searchHistoryMessages(query: string, beforeMessageId?: string) {
  return callInternalDataAction<HistoryMessagePage>('messages.searchHistory', {
    query,
    beforeMessageId,
  });
}

export function getHistoryMessageMatch(
  conversationId: string,
  messageId: string
) {
  return callInternalDataAction<HistoryMessageMatch>(
    'messages.getHistoryMatch',
    {
      conversationId,
      messageId,
    }
  );
}

export function getChatflowInitialInputs(
  conversationId: string
): Promise<Result<Record<string, unknown> | null>> {
  return callInternalDataAction('messages.getChatflowInitialInputs', {
    conversationId,
  });
}

export function getMessagePage(
  conversationId: string,
  options: { limit: number; beforeMessageId?: string }
): Promise<Result<ConversationMessagePage>> {
  return callInternalDataAction<ConversationMessagePage>('messages.getPage', {
    conversationId,
    ...options,
  });
}

export function findDuplicateMessage(
  content: string,
  role: 'user' | 'assistant' | 'system',
  conversationId: string,
  clientMessageId?: string
): Promise<Result<Message | null>> {
  return callInternalDataAction<Message | null>('messages.findDuplicate', {
    content,
    role,
    conversationId,
    clientMessageId,
  });
}

export function saveMessageRecord(
  message: MessageSavePayload
): Promise<Result<Message>> {
  return callInternalDataAction<Message>('messages.save', {
    message,
  });
}

export function updateMessageMetadataRecord(input: {
  conversationId: string;
  messageId: string;
  metadata: Record<string, unknown>;
}): Promise<Result<Message>> {
  return callInternalDataAction<Message>('messages.updateMetadata', input);
}

export function createPlaceholderAssistantMessageRecord(
  conversationId: string,
  status: MessageStatus = 'error',
  errorMessage: string | null = null
): Promise<Result<Message>> {
  return callInternalDataAction<Message>('messages.createPlaceholder', {
    conversationId,
    status,
    errorMessage,
  });
}
