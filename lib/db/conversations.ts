/**
 * Database query functions related to conversations.
 *
 * This file contains all database operations related to the conversations table and messages table.
 * Updated to use unified data service and Result type.
 */
import { dataService } from '@lib/services/db/data-service';
import { Result, failure, success } from '@lib/types/result';

import { Conversation, Message } from '../types/database';

const IS_BROWSER = typeof window !== 'undefined';

type RealtimeRow = Record<string, unknown>;

async function publishRealtimeChangeBestEffort(input: {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: RealtimeRow | null;
  oldRow: RealtimeRow | null;
}) {
  if (IS_BROWSER) {
    return;
  }

  try {
    const runtimeRequire = eval('require') as (id: string) => unknown;
    const publisherModule = runtimeRequire('../server/realtime/publisher') as {
      publishTableChangeEvent?: (payload: {
        table: string;
        eventType: 'INSERT' | 'UPDATE' | 'DELETE';
        newRow: RealtimeRow | null;
        oldRow: RealtimeRow | null;
      }) => Promise<void>;
    };
    const publisher = publisherModule.publishTableChangeEvent;
    if (typeof publisher !== 'function') {
      return;
    }

    await publisher(input);
  } catch (error) {
    console.warn('[ConversationsDB] Realtime publish failed:', error);
  }
}

async function loadConversationRealtimeRow(
  userId: string,
  conversationId: string
): Promise<RealtimeRow | null> {
  const rowResult = await dataService.rawQuery<{
    id: string;
    user_id: string;
    app_id: string | null;
    status: string | null;
    title: string | null;
    updated_at: string | null;
  }>(
    `
      SELECT
        id::text AS id,
        user_id::text AS user_id,
        app_id,
        status,
        title,
        updated_at::text AS updated_at
      FROM conversations
      WHERE id = $1::uuid
        AND user_id = $2::uuid
      LIMIT 1
    `,
    [conversationId, userId]
  );

  if (!rowResult.success || !rowResult.data[0]) {
    return null;
  }

  return rowResult.data[0];
}

/**
 * Get all conversations for a user, supports pagination and filtering by app (optimized version)
 * @param userId User ID
 * @param limit Number of items per page, default is 20
 * @param offset Offset, default is 0
 * @param appId Optional app ID filter
 * @returns Result containing conversation list and total count
 */
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
    // Get conversation list
    const conversationsResult = await dataService.findMany<Conversation>(
      'conversations',
      filters,
      { column: 'updated_at', ascending: false },
      { offset, limit },
      {
        cache: true,
        cacheTTL: 2 * 60 * 1000, // 2 minutes cache
      }
    );

    if (!conversationsResult.success) {
      return failure(conversationsResult.error);
    }

    // Get total count
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

/**
 * Get conversation details (optimized version)
 * @param conversationId Conversation ID
 * @returns Result with conversation object, or null if not found
 */
export async function getConversationById(
  conversationId: string
): Promise<Result<Conversation | null>> {
  return dataService.findOne<Conversation>(
    'conversations',
    { id: conversationId },
    {
      cache: true,
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache
    }
  );
}

/**
 * Create a new conversation (optimized version)
 * @param conversation Conversation object
 * @returns Result with created conversation object, or error if creation failed
 */
export async function createConversation(
  conversation: Omit<Conversation, 'id' | 'created_at' | 'updated_at'>
): Promise<Result<Conversation>> {
  const conversationWithDefaults = {
    ...conversation,
    external_id: conversation.external_id || null,
    app_id: conversation.app_id || null,
    last_message_preview: conversation.last_message_preview || null,
  };

  return dataService.create<Conversation>(
    'conversations',
    conversationWithDefaults
  );
}

/**
 * Update conversation (optimized version)
 * @param id Conversation ID
 * @param updates Fields to update
 * @returns Result with updated conversation object, or error if update failed
 */
export async function updateConversation(
  id: string,
  updates: Partial<Omit<Conversation, 'id' | 'created_at' | 'updated_at'>>
): Promise<Result<Conversation>> {
  const updateData = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  return dataService.update<Conversation>('conversations', id, updateData);
}

/**
 * Delete conversation (soft delete, set status to deleted) (optimized version)
 * @param id Conversation ID
 * @returns Result indicating whether deletion was successful
 */
export async function deleteConversation(id: string): Promise<Result<boolean>> {
  console.log(`[deleteConversation] Start deleting conversation, ID: ${id}`);

  const result = await dataService.softDelete<Conversation>(
    'conversations',
    id
  );

  if (result.success) {
    console.log(`[deleteConversation] Delete operation completed, ID: ${id}`);
    return success(true);
  } else {
    console.error(
      `[deleteConversation] Failed to delete conversation:`,
      result.error
    );
    return success(false);
  }
}

/**
 * Get all messages of a conversation (optimized version)
 * @param conversationId Conversation ID
 * @returns Result with message list
 */
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
      cacheTTL: 1 * 60 * 1000, // 1 minute cache
    }
  );
}

/**
 * Add a message to a conversation (optimized version)
 * @param message Message object
 * @returns Result with created message object, or error if creation failed
 */
export async function addMessageToConversation(
  message: Omit<Message, 'id' | 'created_at'>
): Promise<Result<Message>> {
  const messageWithDefaults = {
    ...message,
    external_id: message.external_id || null,
    token_count: message.token_count || null,
    is_synced: message.is_synced !== undefined ? message.is_synced : true,
  };

  const result = await dataService.create<Message>(
    'messages',
    messageWithDefaults
  );

  if (result.success) {
    // Update conversation's last updated time and last message preview
    const previewText = message.content.substring(0, 100);
    await dataService.update<Conversation>(
      'conversations',
      message.conversation_id,
      {
        updated_at: new Date().toISOString(),
        last_message_preview: previewText,
      }
    );
  }

  return result;
}

/**
 * Update message status (optimized version)
 * @param id Message ID
 * @param status New status
 * @returns Result indicating whether update was successful
 */
export async function updateMessageStatus(
  id: string,
  status: Message['status']
): Promise<Result<boolean>> {
  const result = await dataService.update<Message>('messages', id, { status });
  return success(result.success);
}

/**
 * Query conversation by external ID (Dify conversation ID) (optimized version)
 * @param externalId External ID (Dify conversation ID)
 * @returns Result with conversation object, or null if not found
 */
export async function getConversationByExternalId(
  externalId: string
): Promise<Result<Conversation | null>> {
  if (
    !externalId ||
    typeof externalId !== 'string' ||
    externalId.trim() === ''
  ) {
    console.log(
      '[getConversationByExternalId] Invalid external ID, skip query'
    );
    return success(null);
  }

  console.log(
    `[getConversationByExternalId] Start querying conversation with external ID ${externalId}`
  );

  const result = await dataService.findOne<Conversation>(
    'conversations',
    { external_id: externalId },
    {
      cache: true,
      cacheTTL: 30 * 1000, // 30 seconds cache
    }
  );

  if (result.success && result.data) {
    console.log(
      `[getConversationByExternalId] Found conversation, ID=${result.data.id}, external ID=${externalId}`
    );
  } else if (result.success && !result.data) {
    console.log(
      `[getConversationByExternalId] No conversation found with external ID ${externalId}`
    );
  } else {
    console.error(
      `[getConversationByExternalId] Failed to query conversation:`,
      result.error
    );
  }

  return result;
}

/**
 * Query conversation by external ID with ownership guard.
 * Only returns an active conversation belonging to the provided user.
 */
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

/**
 * Create conversation with ownership guard.
 * Enforces payload user_id to match the authenticated actor.
 */
export async function createConversationForUser(
  userId: string,
  conversation: Omit<Conversation, 'id' | 'created_at' | 'updated_at'>
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

/**
 * Rename conversation (optimized version)
 * @param conversationId Conversation ID
 * @param newTitle New title
 * @returns Result indicating whether update was successful
 */
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

/**
 * Rename conversation with ownership guard.
 * Only conversation owner can rename.
 */
export async function renameConversationForUser(
  userId: string,
  conversationId: string,
  newTitle: string
): Promise<Result<boolean>> {
  const title = newTitle.trim();
  if (!title) {
    return failure(new Error('Conversation title cannot be empty'));
  }

  const oldRow = await loadConversationRealtimeRow(userId, conversationId);

  const result = await dataService.rawQuery<{
    id: string;
    user_id: string;
    app_id: string | null;
    status: string | null;
    title: string | null;
    updated_at: string | null;
  }>(
    `
      UPDATE conversations
      SET title = $1, updated_at = NOW()
      WHERE id = $2::uuid
        AND user_id = $3::uuid
        AND status = 'active'
      RETURNING
        id::text AS id,
        user_id::text AS user_id,
        app_id,
        status,
        title,
        updated_at::text AS updated_at
    `,
    [title, conversationId, userId]
  );

  if (!result.success) {
    return failure(result.error);
  }

  if (result.data.length > 0) {
    dataService.clearCache('conversations');
    await publishRealtimeChangeBestEffort({
      table: 'conversations',
      eventType: 'UPDATE',
      oldRow,
      newRow: result.data[0],
    });
    return success(true);
  }

  return success(false);
}

/**
 * Soft delete conversation with ownership guard.
 * Only conversation owner can delete.
 */
export async function deleteConversationForUser(
  userId: string,
  conversationId: string
): Promise<Result<boolean>> {
  const oldRow = await loadConversationRealtimeRow(userId, conversationId);

  const result = await dataService.rawQuery<{
    id: string;
    user_id: string;
    app_id: string | null;
    status: string | null;
    title: string | null;
    updated_at: string | null;
  }>(
    `
      UPDATE conversations
      SET status = 'deleted', updated_at = NOW()
      WHERE id = $1::uuid
        AND user_id = $2::uuid
        AND status = 'active'
      RETURNING
        id::text AS id,
        user_id::text AS user_id,
        app_id,
        status,
        title,
        updated_at::text AS updated_at
    `,
    [conversationId, userId]
  );

  if (!result.success) {
    return failure(result.error);
  }

  if (result.data.length > 0) {
    dataService.clearCache('conversations');
    await publishRealtimeChangeBestEffort({
      table: 'conversations',
      eventType: 'UPDATE',
      oldRow,
      newRow: result.data[0],
    });
    return success(true);
  }

  return success(false);
}

/**
 * Physically delete conversation and its messages (optimized version)
 * @param conversationId Conversation ID
 * @returns Result indicating whether deletion was successful
 */
export async function permanentlyDeleteConversation(
  conversationId: string
): Promise<Result<boolean>> {
  try {
    const oldConversationResult = await dataService.rawQuery<{
      id: string;
      user_id: string;
      app_id: string | null;
      status: string | null;
      title: string | null;
      updated_at: string | null;
    }>(
      `
        SELECT
          id::text AS id,
          user_id::text AS user_id,
          app_id,
          status,
          title,
          updated_at::text AS updated_at
        FROM conversations
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [conversationId]
    );

    const oldMessageResult = await dataService.rawQuery<{
      id: string;
      conversation_id: string;
    }>(
      `
        SELECT
          id::text AS id,
          conversation_id::text AS conversation_id
        FROM messages
        WHERE conversation_id = $1::uuid
        LIMIT 1
      `,
      [conversationId]
    );

    const transactionResult = await dataService.runInTransaction(
      async client => {
        await client.query('DELETE FROM messages WHERE conversation_id = $1', [
          conversationId,
        ]);
        await client.query('DELETE FROM conversations WHERE id = $1', [
          conversationId,
        ]);
        return true;
      }
    );
    if (!transactionResult.success) {
      return failure(transactionResult.error);
    }

    dataService.clearCache('messages');
    dataService.clearCache('conversations');

    const oldConversation = oldConversationResult.success
      ? oldConversationResult.data[0] || null
      : null;
    const oldMessage = oldMessageResult.success
      ? oldMessageResult.data[0] || null
      : null;

    if (oldMessage) {
      await publishRealtimeChangeBestEffort({
        table: 'messages',
        eventType: 'DELETE',
        oldRow: oldMessage,
        newRow: null,
      });
    }

    if (oldConversation) {
      await publishRealtimeChangeBestEffort({
        table: 'conversations',
        eventType: 'DELETE',
        oldRow: oldConversation,
        newRow: null,
      });
    }

    return success(true);
  } catch (error) {
    console.error('Failed to physically delete conversation:', error);
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Create a new empty conversation (optimized version)
 * @param userId User ID
 * @param appId App ID
 * @param initialTitle Initial title (optional)
 * @returns Result with created conversation object
 */
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

/**
 * Update conversation metadata (optimized version)
 * @param conversationId Conversation ID
 * @param metadata Metadata object
 * @returns Result indicating whether update was successful
 */
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

// Compatibility functions to maintain compatibility with existing code
// These functions will gradually migrate to use the Result type
/**
 * Get all conversations for a user (legacy version)
 * @deprecated Please use the new version and handle the Result type
 */
export async function getUserConversationsLegacy(
  userId: string,
  limit: number = 20,
  offset: number = 0,
  appId?: string
): Promise<{ conversations: Conversation[]; total: number }> {
  const result = await getUserConversations(userId, limit, offset, appId);
  return result.success ? result.data : { conversations: [], total: 0 };
}

/**
 * Get conversation details (legacy version)
 * @deprecated Please use the new version and handle the Result type
 */
export async function getConversationByIdLegacy(
  conversationId: string
): Promise<Conversation | null> {
  const result = await getConversationById(conversationId);
  return result.success ? result.data : null;
}
