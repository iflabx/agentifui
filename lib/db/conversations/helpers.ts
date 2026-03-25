import type { Conversation, Message } from '../../types/database';
import type {
  ConversationCreateInput,
  ConversationUpdateInput,
  MessageCreateInput,
} from './types';

export function buildConversationCreateInput(
  conversation: ConversationCreateInput
): ConversationCreateInput {
  return {
    ...conversation,
    external_id: conversation.external_id || null,
    app_id: conversation.app_id || null,
    last_message_preview: conversation.last_message_preview || null,
  };
}

export function buildConversationUpdateInput(
  updates: ConversationUpdateInput
): ConversationUpdateInput & { updated_at: string } {
  return {
    ...updates,
    updated_at: new Date().toISOString(),
  };
}

export function buildMessageCreateInput(
  message: MessageCreateInput
): MessageCreateInput {
  return {
    ...message,
    external_id: message.external_id || null,
    token_count: message.token_count || null,
    is_synced: message.is_synced !== undefined ? message.is_synced : true,
  };
}

export function getMessagePreviewText(content: Message['content']) {
  return content.substring(0, 100);
}

export function normalizeExternalId(externalId: string) {
  if (
    !externalId ||
    typeof externalId !== 'string' ||
    externalId.trim() === ''
  ) {
    return null;
  }

  return externalId.trim();
}
