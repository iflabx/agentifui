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

export function findDuplicateMessage(
  content: string,
  role: 'user' | 'assistant' | 'system',
  conversationId: string
): Promise<Result<Message | null>> {
  return callInternalDataAction<Message | null>('messages.findDuplicate', {
    content,
    role,
    conversationId,
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
