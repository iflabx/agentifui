import { type Result, failure, success } from '@lib/types/result';

import type { Conversation, Message } from '../../types/database';
import { normalizeExternalId } from './helpers';
import { dataService } from './shared';

export async function getUserConversations(
  userId: string,
  limit: number = 20,
  offset: number = 0,
  appId?: string
): Promise<Result<{ conversations: Conversation[]; total: number }>> {
  const filters = {
    user_id: userId,
    status: 'active',
    ...(appId && { app_id: appId }),
  };

  try {
    const conversationsResult = await dataService.findMany<Conversation>(
      'conversations',
      filters,
      { column: 'updated_at', ascending: false },
      { offset, limit },
      {
        cache: true,
        cacheTTL: 2 * 60 * 1000,
      }
    );

    if (!conversationsResult.success) {
      return failure(conversationsResult.error);
    }

    const countResult = await dataService.count('conversations', filters);
    if (!countResult.success) {
      return failure(countResult.error);
    }

    return success({
      conversations: conversationsResult.data,
      total: countResult.data,
    });
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function getConversationById(
  conversationId: string
): Promise<Result<Conversation | null>> {
  return dataService.findOne<Conversation>(
    'conversations',
    { id: conversationId },
    {
      cache: true,
      cacheTTL: 5 * 60 * 1000,
    }
  );
}

export async function getConversationMessages(
  conversationId: string
): Promise<Result<Message[]>> {
  return dataService.findMany<Message>(
    'messages',
    { conversation_id: conversationId },
    { column: 'created_at', ascending: true },
    undefined,
    {
      cache: true,
      cacheTTL: 1 * 60 * 1000,
    }
  );
}

export async function getConversationByExternalId(
  externalId: string
): Promise<Result<Conversation | null>> {
  const normalizedExternalId = normalizeExternalId(externalId);
  if (!normalizedExternalId) {
    console.log(
      '[getConversationByExternalId] Invalid external ID, skip query'
    );
    return success(null);
  }

  console.log(
    `[getConversationByExternalId] Start querying conversation with external ID ${normalizedExternalId}`
  );

  const result = await dataService.findOne<Conversation>(
    'conversations',
    { external_id: normalizedExternalId },
    {
      cache: true,
      cacheTTL: 30 * 1000,
    }
  );

  if (result.success && result.data) {
    console.log(
      `[getConversationByExternalId] Found conversation, ID=${result.data.id}, external ID=${normalizedExternalId}`
    );
  } else if (result.success) {
    console.log(
      `[getConversationByExternalId] No conversation found with external ID ${normalizedExternalId}`
    );
  } else {
    console.error(
      '[getConversationByExternalId] Failed to query conversation:',
      result.error
    );
  }

  return result;
}

export async function getConversationByExternalIdForUser(
  userId: string,
  externalId: string
): Promise<Result<Conversation | null>> {
  const normalizedUserId = userId.trim();
  const normalizedExternalId = externalId.trim();

  if (!normalizedUserId) {
    return failure(new Error('User ID is required'));
  }

  if (!normalizedExternalId) {
    return success(null);
  }

  const result = await dataService.rawQuery<Conversation>(
    `
      SELECT
        id::text AS id,
        user_id::text AS user_id,
        ai_config_id,
        title,
        summary,
        settings,
        created_at::text AS created_at,
        updated_at::text AS updated_at,
        status,
        external_id,
        app_id,
        last_message_preview,
        metadata
      FROM conversations
      WHERE external_id = $1
        AND user_id = $2::uuid
        AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [normalizedExternalId, normalizedUserId]
  );

  if (!result.success) {
    return failure(result.error);
  }

  return success(result.data[0] || null);
}
