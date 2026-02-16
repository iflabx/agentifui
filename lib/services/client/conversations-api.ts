import { callInternalDataAction } from '@lib/db/internal-data-api';
import type { Conversation } from '@lib/types/database';
import { Result, failure, success } from '@lib/types/result';

type ConversationInput = Omit<Conversation, 'id' | 'created_at' | 'updated_at'>;
type ConversationUpdates = Partial<
  Omit<Conversation, 'id' | 'created_at' | 'updated_at' | 'user_id'>
>;

export async function getConversationByExternalId(
  externalId: string
): Promise<Result<Conversation | null>> {
  const normalizedExternalId = externalId.trim();
  if (!normalizedExternalId) {
    return { success: true, data: null };
  }

  const result = await callInternalDataAction<Conversation | null>(
    'conversations.getConversationByExternalId',
    {
      externalId: normalizedExternalId,
    }
  );

  if (
    !result.success &&
    /(Unauthorized|Forbidden)/i.test(result.error.message)
  ) {
    return success(null);
  }

  return result;
}

export async function createConversation(
  conversation: ConversationInput
): Promise<Result<Conversation>> {
  return callInternalDataAction<Conversation>(
    'conversations.createConversation',
    {
      conversation,
    }
  );
}

export async function updateConversation(
  conversationId: string,
  updates: ConversationUpdates
): Promise<Result<boolean>> {
  const normalizedConversationId = conversationId.trim();
  const normalizedTitle =
    typeof updates.title === 'string' ? updates.title.trim() : '';

  if (!normalizedConversationId) {
    return failure('Conversation ID is required');
  }

  if (!normalizedTitle) {
    return failure('Only title update is supported in browser runtime');
  }

  return callInternalDataAction<boolean>('conversations.renameConversation', {
    conversationId: normalizedConversationId,
    title: normalizedTitle,
  });
}
