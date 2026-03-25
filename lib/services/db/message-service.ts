/**
 * Optimized database message service
 *
 * Handles message-related data operations, optimized for pagination and sorting.
 * Uses database-level sorting to avoid complex client-side logic.
 */
import { ChatMessage } from '@lib/stores/chat-store';
import { Message, MessageStatus } from '@lib/types/database';
import { Result } from '@lib/types/result';

import {
  clearAllConversationMessagesCache,
  clearConversationMessagesCache,
} from './message-service/cache';
import {
  chatMessageToDbMessage as mapChatMessageToDbMessage,
  dbMessageToChatMessage as mapDbMessageToChatMessage,
} from './message-service/mapping';
import {
  getMessageStats as getConversationMessageStats,
  getMessagesPaginated as getConversationMessagesPaginated,
  getLatestMessages as getLatestMessagesPage,
} from './message-service/pagination';
import {
  findDuplicateMessage as findExistingDuplicateMessage,
  saveMessage as persistMessage,
  updateMessageStatus as persistMessageStatus,
  saveMessages as persistMessages,
} from './message-service/persistence';
import type { MessagePage, SaveMessageInput } from './message-service/types';

export class MessageService {
  private static instance: MessageService;

  private constructor() {}

  /**
   * Get the singleton instance of the message service
   */
  public static getInstance(): MessageService {
    if (!MessageService.instance) {
      MessageService.instance = new MessageService();
    }
    return MessageService.instance;
  }

  /**
   * Get paginated messages for a conversation (optimized pagination)
   * Uses cursor-based pagination for better performance
   */
  async getMessagesPaginated(
    conversationId: string,
    options: {
      limit?: number;
      cursor?: string;
      direction?: 'newer' | 'older';
      includeCount?: boolean;
      cache?: boolean;
    } = {}
  ): Promise<Result<MessagePage>> {
    return getConversationMessagesPaginated(conversationId, options);
  }

  /**
   * Get the latest messages (for initial load)
   */
  async getLatestMessages(
    conversationId: string,
    limit: number = 20,
    options: { cache?: boolean } = {}
  ): Promise<Result<Message[]>> {
    return getLatestMessagesPage(conversationId, limit, options);
  }

  /**
   * Save a message to the database
   * For assistant messages, also update the conversation preview (extract main content intelligently)
   */
  async saveMessage(message: SaveMessageInput): Promise<Result<Message>> {
    return persistMessage(message);
  }

  /**
   * Batch save messages
   */
  async saveMessages(messages: SaveMessageInput[]): Promise<Result<string[]>> {
    return persistMessages(messages);
  }

  /**
   * Update message status
   */
  async updateMessageStatus(
    messageId: string,
    status: MessageStatus
  ): Promise<Result<Message>> {
    return persistMessageStatus(messageId, status);
  }

  /**
   * Convert a frontend ChatMessage to a database Message
   */
  chatMessageToDbMessage(
    chatMessage: ChatMessage,
    conversationId: string,
    userId?: string | null
  ): Omit<Message, 'id' | 'created_at' | 'is_synced'> {
    return mapChatMessageToDbMessage(chatMessage, conversationId, userId);
  }

  /**
   * Convert a database Message to a frontend ChatMessage
   */
  dbMessageToChatMessage(dbMessage: Message): ChatMessage {
    return mapDbMessageToChatMessage(dbMessage);
  }

  /**
   * Find duplicate message (for deduplication)
   */
  async findDuplicateMessage(
    content: string,
    role: 'user' | 'assistant' | 'system',
    conversationId: string
  ): Promise<Result<Message | null>> {
    return findExistingDuplicateMessage(content, role, conversationId);
  }

  /**
   * Get message statistics
   */
  async getMessageStats(conversationId: string): Promise<
    Result<{
      total: number;
      byRole: Record<string, number>;
      lastMessageAt?: string;
    }>
  > {
    return getConversationMessageStats(conversationId);
  }

  /**
   * Clear message cache
   */
  clearMessageCache(conversationId?: string): number {
    if (conversationId) {
      return clearConversationMessagesCache(conversationId);
    } else {
      return clearAllConversationMessagesCache();
    }
  }
}

// Export singleton instance
export const messageService = MessageService.getInstance();
