import type { ChatMessage, MessageAttachment } from '@lib/stores/chat-store';
import type { Message } from '@lib/types/database';

import type { LoadingStatus } from './types';

function isMessageAttachmentArray(
  value: unknown
): value is MessageAttachment[] {
  return (
    Array.isArray(value) &&
    value.every(item => {
      if (!item || typeof item !== 'object') {
        return false;
      }
      const record = item as Record<string, unknown>;
      return (
        typeof record.id === 'string' &&
        typeof record.name === 'string' &&
        typeof record.size === 'number' &&
        typeof record.type === 'string' &&
        typeof record.upload_file_id === 'string'
      );
    })
  );
}

export function dbMessageToChatMessage(dbMessage: Message): ChatMessage {
  const rawAttachments = dbMessage.metadata?.attachments;
  const attachments = isMessageAttachmentArray(rawAttachments)
    ? rawAttachments
    : [];

  return {
    id: `db-${dbMessage.id}`,
    text: dbMessage.content,
    isUser: dbMessage.role === 'user',
    role: dbMessage.role,
    persistenceStatus: 'saved',
    db_id: dbMessage.id,
    dify_message_id: dbMessage.external_id || undefined,
    metadata: dbMessage.metadata || {},
    wasManuallyStopped: dbMessage.metadata?.stopped_manually === true,
    token_count: dbMessage.token_count || undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    sequence_index: dbMessage.sequence_index,
  };
}

export function sortMessagesByTime(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();

    if (timeA !== timeB) {
      return timeA - timeB;
    }

    return a.id.localeCompare(b.id);
  });
}

export function organizeMessages(messages: Message[]): Message[] {
  return sortMessagesByTime(messages);
}

export function getConversationIdFromPath(pathname: string) {
  if (!pathname) {
    return null;
  }

  if (
    pathname.startsWith('/chat/') &&
    !pathname.includes('/chat/new') &&
    !pathname.includes('/chat/temp-')
  ) {
    return pathname.replace('/chat/', '');
  }

  return null;
}

export function shouldLoadMoreMessages(input: {
  dbConversationId: string | null;
  hasMoreMessages: boolean;
  loading: LoadingStatus;
}) {
  return !(
    !input.dbConversationId ||
    input.loading.isLocked ||
    input.loading.state === 'loading' ||
    input.loading.state === 'complete' ||
    !input.hasMoreMessages ||
    input.loading.type === 'initial'
  );
}

export function shouldHandleScrollLoad(input: {
  hasMoreMessages: boolean;
  loading: LoadingStatus;
  scrollTop: number;
  threshold?: number;
}) {
  if (
    !input.hasMoreMessages ||
    input.loading.state === 'loading' ||
    input.loading.isLocked
  ) {
    return false;
  }

  return input.scrollTop < (input.threshold ?? 50);
}

export function shouldPreserveMessagesOnRouteTransition(input: {
  currentMessages: ChatMessage[];
  externalId: string | null;
  previousPath: string | null;
}) {
  const isFromNewChat =
    input.previousPath === '/chat/new' ||
    (input.previousPath?.includes('/chat/temp-') ?? false);
  const isToExistingChat =
    !!input.externalId &&
    input.externalId !== 'new' &&
    !input.externalId.includes('temp-');
  const hasExistingMessages = input.currentMessages.length > 0;
  const hasStreamingMessage = input.currentMessages.some(
    message => message.isStreaming === true
  );
  const hasPendingUserMessage = input.currentMessages.some(
    message =>
      message.isUser === true &&
      (message.persistenceStatus === 'pending' ||
        message.persistenceStatus === 'saving')
  );

  return (
    (isFromNewChat && isToExistingChat && hasExistingMessages) ||
    (hasExistingMessages && (hasStreamingMessage || hasPendingUserMessage))
  );
}
