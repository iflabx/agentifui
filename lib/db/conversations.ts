/**
 * Database query functions related to conversations.
 *
 * This file contains all database operations related to the conversations table and messages table.
 * Updated to use unified data service and Result type.
 */
import { getPgPool } from '@lib/server/pg/pool';
import { dataService } from '@lib/services/db/data-service';
import { Result, failure, success } from '@lib/types/result';

import { Conversation, Message } from '../types/database';

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
 * Physically delete conversation and its messages (optimized version)
 * @param conversationId Conversation ID
 * @returns Result indicating whether deletion was successful
 */
export async function permanentlyDeleteConversation(
  conversationId: string
): Promise<Result<boolean>> {
  try {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM messages WHERE conversation_id = $1', [
        conversationId,
      ]);
      await client.query('DELETE FROM conversations WHERE id = $1', [
        conversationId,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    dataService.clearCache('messages');
    dataService.clearCache('conversations');
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
