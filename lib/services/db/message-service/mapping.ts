import { ChatMessage, MessageAttachment } from '@lib/stores/chat-store';
import { Message } from '@lib/types/database';
import { resolvePersistedStoppedAssistantText } from '@lib/utils/stopped-message-content';

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
        typeof record.upload_file_id === 'string' &&
        (record.preview_file_id === undefined ||
          typeof record.preview_file_id === 'string')
      );
    })
  );
}

export function chatMessageToDbMessage(
  chatMessage: ChatMessage,
  conversationId: string,
  userId?: string | null
): Omit<Message, 'id' | 'created_at' | 'is_synced'> {
  const baseMetadata = chatMessage.metadata || {};

  if (chatMessage.wasManuallyStopped && !baseMetadata.stopped_manually) {
    baseMetadata.stopped_manually = true;
    baseMetadata.stopped_at =
      baseMetadata.stopped_at || new Date().toISOString();
  }

  if (chatMessage.attachments && chatMessage.attachments.length > 0) {
    baseMetadata.attachments = chatMessage.attachments;
  }

  const sequence_index =
    chatMessage.sequence_index !== undefined
      ? chatMessage.sequence_index
      : chatMessage.isUser
        ? 0
        : 1;

  return {
    conversation_id: conversationId,
    user_id: chatMessage.isUser ? userId || null : null,
    role: chatMessage.role || (chatMessage.isUser ? 'user' : 'assistant'),
    content: chatMessage.text,
    metadata: baseMetadata,
    status: chatMessage.error ? 'error' : 'sent',
    external_id: chatMessage.dify_message_id || null,
    token_count: chatMessage.token_count || null,
    sequence_index,
  };
}

export function dbMessageToChatMessage(dbMessage: Message): ChatMessage {
  const rawAttachments = dbMessage.metadata?.attachments;
  const attachments = isMessageAttachmentArray(rawAttachments)
    ? rawAttachments
    : [];
  const resolvedContent = resolvePersistedStoppedAssistantText({
    content: dbMessage.content,
    metadata: dbMessage.metadata,
  });

  return {
    id: `db-${dbMessage.id}`,
    text: resolvedContent,
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
