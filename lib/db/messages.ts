/**
 * Database operation functions related to messages.
 *
 * This file contains all database operations related to the messages table.
 * Updated to use the new messageService and unified data service, while retaining compatibility versions.
 */
import { messageService } from '@lib/services/db/message-service';
import { ChatMessage } from '@lib/stores/chat-store';
import { Message, MessageStatus } from '@lib/types/database';
import { Result, failure, success } from '@lib/types/result';

/**
 * Save a message to the database (optimized version)
 * @param message Message object
 * @returns Result with the saved message object, or error if failed
 */
export async function saveMessage(message: {
  conversation_id: string;
  user_id?: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, any>;
  status?: MessageStatus;
  external_id?: string | null;
  token_count?: number | null;
  sequence_index?: number;
}): Promise<Result<Message>> {
  console.log(
    `[saveMessage] Start saving message, conversationId=${message.conversation_id}, role=${message.role}`
  );
  // Directly pass sequence_index
  const result = await messageService.saveMessage(message);
  if (result.success) {
    console.log(
      `[saveMessage] Message saved successfully, messageId=${result.data.id}`
    );
  } else {
    console.error(`[saveMessage] Failed to save message:`, result.error);
  }
  return result;
}

/**
 * Batch save multiple messages (optimized version)
 * @param messages Array of message objects
 * @returns Result with array of saved message IDs
 */
export async function saveMessages(
  messages: {
    conversation_id: string;
    user_id?: string | null;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, any>;
    status?: MessageStatus;
    external_id?: string | null;
    token_count?: number | null;
    sequence_index?: number;
  }[]
): Promise<Result<string[]>> {
  if (!messages.length) {
    return success([]);
  }
  console.log(`[saveMessages] Start batch saving ${messages.length} messages`);
  // Directly pass sequence_index
  const result = await messageService.saveMessages(messages);
  if (result.success) {
    console.log(
      `[saveMessages] Batch save successful, saved ${result.data.length} messages`
    );
  } else {
    console.error(`[saveMessages] Batch save failed:`, result.error);
  }
  return result;
}

/**
 * Update message status (optimized version)
 * @param messageId Message ID
 * @param status New status
 * @returns Result indicating whether update was successful
 */
export async function updateMessageStatus(
  messageId: string,
  status: MessageStatus
): Promise<Result<boolean>> {
  console.log(
    `[updateMessageStatus] Update message status, messageId=${messageId}, new status=${status}`
  );

  const result = await messageService.updateMessageStatus(messageId, status);

  if (result.success) {
    console.log(`[updateMessageStatus] Message status updated successfully`);
    return success(true);
  } else {
    console.error(
      `[updateMessageStatus] Failed to update message status:`,
      result.error
    );
    return success(false);
  }
}

/**
 * Get all messages by conversation ID (optimized version)
 * @param conversationId Conversation ID
 * @returns Result with array of messages
 */
export async function getMessagesByConversationId(
  conversationId: string,
  limit: number = 1000
): Promise<Result<Message[]>> {
  console.log(
    `[getMessagesByConversationId] Get messages for conversation, conversationId=${conversationId}, limit=${limit}`
  );

  const result = await messageService.getLatestMessages(conversationId, limit, {
    cache: true,
  });

  if (result.success) {
    console.log(
      `[getMessagesByConversationId] Successfully got messages, total=${result.data.length}`
    );
  } else {
    console.error(
      `[getMessagesByConversationId] Failed to get messages:`,
      result.error
    );
  }

  return result;
}

/**
 * Convert frontend ChatMessage object to database Message object (using messageService)
 * @param chatMessage Frontend message object
 * @param conversationId Conversation ID
 * @param userId User ID (optional, required for user messages)
 * @returns Database message object
 */
export function chatMessageToDbMessage(
  chatMessage: ChatMessage,
  conversationId: string,
  userId?: string | null
): Omit<Message, 'id' | 'created_at' | 'is_synced'> {
  // Directly pass sequence_index
  return messageService.chatMessageToDbMessage(
    chatMessage,
    conversationId,
    userId
  );
}

/**
 * Create a placeholder assistant message for error (optimized version)
 * @param conversationId Conversation ID
 * @param status Message status
 * @param errorMessage Error message
 * @returns Result with the saved message object
 */
export async function createPlaceholderAssistantMessage(
  conversationId: string,
  status: MessageStatus = 'error',
  errorMessage: string | null = null
): Promise<Result<Message>> {
  console.log(
    `[createPlaceholderAssistantMessage] Create placeholder assistant message, conversationId=${conversationId}`
  );
  // Directly pass sequence_index: 1
  return saveMessage({
    conversation_id: conversationId,
    user_id: null,
    role: 'assistant',
    content: errorMessage || 'Failed to generate assistant message',
    metadata: { error: true, errorMessage },
    status,
    sequence_index: 1,
  });
}

/**
 * Query message by content and role, used for duplicate check (optimized version)
 */
export async function getMessageByContentAndRole(
  content: string,
  role: 'user' | 'assistant' | 'system',
  conversationId: string
): Promise<Result<Message | null>> {
  try {
    // Use messageService to find duplicate message
    const result = await messageService.findDuplicateMessage(
      content,
      role,
      conversationId
    );

    if (result.success) {
      return result;
    } else {
      console.error(
        '[getMessageByContentAndRole] Failed to query message:',
        result.error
      );
      return result;
    }
  } catch (e) {
    console.error(
      '[getMessageByContentAndRole] Exception when querying message:',
      e
    );
    return failure(e instanceof Error ? e : new Error(String(e)));
  }
}

// Compatibility functions, keep compatibility with existing code
// These functions will gradually migrate to use Result type
/**
 * Save message to database (legacy version)
 * @deprecated Please use the new version and handle Result type
 */
export async function saveMessageLegacy(message: {
  conversation_id: string;
  user_id?: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, any>;
  status?: MessageStatus;
  external_id?: string | null;
  token_count?: number | null;
}): Promise<Message | null> {
  const result = await saveMessage(message);
  return result.success ? result.data : null;
}

/**
 * Batch save multiple messages (legacy version)
 * @deprecated Please use the new version and handle Result type
 */
export async function saveMessagesLegacy(
  messages: {
    conversation_id: string;
    user_id?: string | null;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, any>;
    status?: MessageStatus;
    external_id?: string | null;
    token_count?: number | null;
  }[]
): Promise<string[]> {
  const result = await saveMessages(messages);
  return result.success ? result.data : [];
}

/**
 * Update message status (legacy version)
 * @deprecated Please use the new version and handle Result type
 */
export async function updateMessageStatusLegacy(
  messageId: string,
  status: MessageStatus
): Promise<boolean> {
  const result = await updateMessageStatus(messageId, status);
  return result.success ? result.data : false;
}

/**
 * Get all messages by conversation ID (legacy version)
 * @deprecated Please use the new version and handle Result type
 */
export async function getMessagesByConversationIdLegacy(
  conversationId: string
): Promise<Message[]> {
  const result = await getMessagesByConversationId(conversationId);
  return result.success ? result.data : [];
}

/**
 * Create placeholder assistant message for error (legacy version)
 * @deprecated Please use the new version and handle Result type
 */
export async function createPlaceholderAssistantMessageLegacy(
  conversationId: string,
  status: MessageStatus = 'error',
  errorMessage: string | null = null
): Promise<Message | null> {
  const result = await createPlaceholderAssistantMessage(
    conversationId,
    status,
    errorMessage
  );
  return result.success ? result.data : null;
}

/**
 * Query message by content and role, used for duplicate check (legacy version)
 * @deprecated Please use the new version and handle Result type
 */
export async function getMessageByContentAndRoleLegacy(
  content: string,
  role: 'user' | 'assistant' | 'system',
  conversationId: string
): Promise<Message | null> {
  const result = await getMessageByContentAndRole(
    content,
    role,
    conversationId
  );
  return result.success ? result.data : null;
}
