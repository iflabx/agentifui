import { type Result, failure, success } from '@lib/types/result';

import type { Conversation, Message } from '../../types/database';
import {
  buildConversationCreateInput,
  buildConversationUpdateInput,
  buildMessageCreateInput,
  getMessagePreviewText,
} from './helpers';
import { dataService } from './shared';
import type {
  ConversationCreateInput,
  ConversationUpdateInput,
  MessageCreateInput,
} from './types';

export async function createConversation(
  conversation: ConversationCreateInput
): Promise<Result<Conversation>> {
  return dataService.create<Conversation>(
    'conversations',
    buildConversationCreateInput(conversation)
  );
}

export async function updateConversation(
  id: string,
  updates: ConversationUpdateInput
): Promise<Result<Conversation>> {
  return dataService.update<Conversation>(
    'conversations',
    id,
    buildConversationUpdateInput(updates)
  );
}

export async function deleteConversation(id: string): Promise<Result<boolean>> {
  console.log(`[deleteConversation] Start deleting conversation, ID: ${id}`);

  const result = await dataService.softDelete<Conversation>(
    'conversations',
    id
  );

  if (result.success) {
    console.log(`[deleteConversation] Delete operation completed, ID: ${id}`);
    return success(true);
  }

  console.error(
    '[deleteConversation] Failed to delete conversation:',
    result.error
  );
  return success(false);
}

export async function addMessageToConversation(
  message: MessageCreateInput
): Promise<Result<Message>> {
  const result = await dataService.create<Message>(
    'messages',
    buildMessageCreateInput(message)
  );

  if (result.success) {
    await dataService.update<Conversation>(
      'conversations',
      message.conversation_id,
      {
        updated_at: new Date().toISOString(),
        last_message_preview: getMessagePreviewText(message.content),
      }
    );
  }

  return result;
}

export async function updateMessageStatus(
  id: string,
  status: Message['status']
): Promise<Result<boolean>> {
  const result = await dataService.update<Message>('messages', id, { status });
  return success(result.success);
}

export async function createConversationForUser(
  userId: string,
  conversation: ConversationCreateInput
): Promise<Result<Conversation>> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return failure(new Error('User ID is required'));
  }

  return createConversation({
    ...conversation,
    user_id: normalizedUserId,
  });
}

export async function renameConversation(
  conversationId: string,
  newTitle: string
): Promise<Result<boolean>> {
  const result = await dataService.update<Conversation>(
    'conversations',
    conversationId,
    { title: newTitle }
  );
  return success(result.success);
}

export async function createEmptyConversation(
  userId: string,
  appId: string,
  initialTitle?: string
): Promise<Result<Conversation>> {
  return createConversation({
    user_id: userId,
    title: initialTitle || 'New Conversation',
    summary: null,
    ai_config_id: null,
    app_id: appId,
    external_id: null,
    settings: {},
    status: 'active',
    last_message_preview: null,
  });
}

export async function updateConversationMetadata(
  conversationId: string,
  metadata: Record<string, unknown>
): Promise<Result<boolean>> {
  const result = await dataService.update<Conversation>(
    'conversations',
    conversationId,
    { metadata }
  );
  return success(result.success);
}
