/**
 * Optimized database message service
 *
 * Handles message-related data operations, optimized for pagination and sorting.
 * Uses database-level sorting to avoid complex client-side logic.
 */
import { getPgPool } from '@lib/server/pg/pool';
import { ChatMessage } from '@lib/stores/chat-store';
import { Message, MessageStatus } from '@lib/types/database';
import { Result, success } from '@lib/types/result';

import { extractMainContentForPreview } from '../../utils/index';
import { cacheService } from './cache-service';
import { dataService } from './data-service';

export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
  nextCursor?: string;
  totalCount?: number;
}

export interface PaginationCursor {
  timestamp: string;
  id: string;
}

function normalizeMessageRow(row: Record<string, unknown>): Message {
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at);

  return {
    ...row,
    created_at: createdAt,
  } as Message;
}

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
    const {
      limit = 20,
      cursor,
      direction = 'older',
      includeCount = false,
      cache = true,
    } = options;

    const cacheKey = cache
      ? `conversation:messages:${conversationId}:${cursor ? `${cursor.substring(0, 8)}:${direction}:${limit}` : `initial:${limit}`}`
      : undefined;

    return dataService.query(
      async () => {
        let cursorData: PaginationCursor | null = null;
        if (cursor) {
          try {
            cursorData = JSON.parse(atob(cursor));
          } catch {
            throw new Error('Invalid pagination cursor');
          }
        }

        const params: unknown[] = [conversationId];
        const whereClauses = ['conversation_id = $1'];
        let nextParamIndex = 2;

        if (cursorData) {
          const timestampParam = `$${nextParamIndex}`;
          const idParam = `$${nextParamIndex + 1}`;
          params.push(cursorData.timestamp, cursorData.id);

          if (direction === 'older') {
            whereClauses.push(
              `(created_at < ${timestampParam} OR (created_at = ${timestampParam} AND id < ${idParam}))`
            );
          } else {
            whereClauses.push(
              `(created_at > ${timestampParam} OR (created_at = ${timestampParam} AND id > ${idParam}))`
            );
          }
          nextParamIndex += 2;
        }

        params.push(limit + 1);
        const limitParam = `$${nextParamIndex}`;
        const pool = getPgPool();
        const sql = `
          SELECT *
          FROM messages
          WHERE ${whereClauses.join(' AND ')}
          ORDER BY created_at DESC, sequence_index DESC, id DESC
          LIMIT ${limitParam}
        `;
        const queryResult = await pool.query(sql, params);
        const rows = queryResult.rows.map(row => normalizeMessageRow(row));

        const hasMore = rows.length > limit;
        const actualMessages = hasMore ? rows.slice(0, limit) : rows;

        let nextCursor: string | undefined;
        if (hasMore && actualMessages.length > 0) {
          const lastMessage = actualMessages[actualMessages.length - 1];
          const cursorObj: PaginationCursor = {
            timestamp: lastMessage.created_at,
            id: lastMessage.id,
          };
          nextCursor = btoa(JSON.stringify(cursorObj));
        }

        let totalCount: number | undefined;
        if (includeCount) {
          const countResult = await dataService.count('messages', {
            conversation_id: conversationId,
          });
          if (countResult.success) {
            totalCount = countResult.data;
          }
        }

        return {
          messages: actualMessages,
          hasMore,
          nextCursor,
          totalCount,
        };
      },
      cacheKey,
      { cache }
    );
  }

  /**
   * Get the latest messages (for initial load)
   */
  async getLatestMessages(
    conversationId: string,
    limit: number = 20,
    options: { cache?: boolean } = {}
  ): Promise<Result<Message[]>> {
    const { cache = true } = options;

    return dataService.query(
      async () => {
        const pool = getPgPool();
        const queryResult = await pool.query(
          `
            SELECT *
            FROM messages
            WHERE conversation_id = $1
            ORDER BY created_at ASC, sequence_index ASC, id ASC
            LIMIT $2
          `,
          [conversationId, limit]
        );

        return queryResult.rows.map(row => normalizeMessageRow(row));
      },
      cache
        ? `conversation:messages:latest:${conversationId}:${limit}`
        : undefined,
      { cache }
    );
  }

  /**
   * Save a message to the database
   * For assistant messages, also update the conversation preview (extract main content intelligently)
   */
  async saveMessage(message: {
    conversation_id: string;
    user_id?: string | null;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
    status?: MessageStatus;
    external_id?: string | null;
    token_count?: number | null;
    sequence_index?: number;
  }): Promise<Result<Message>> {
    const sequence_index =
      message.sequence_index !== undefined
        ? message.sequence_index
        : message.role === 'user'
          ? 0
          : 1;
    const messageData = {
      ...message,
      metadata: message.metadata || {},
      status: message.status || 'sent',
      is_synced: true,
      sequence_index,
    };

    // For assistant messages, update conversation preview when saving
    // Use a transaction to ensure data consistency and avoid extra DB operations
    if (message.role === 'assistant') {
      return dataService.query(async () => {
        // 1. Save the message
        const savedMessageResult = await dataService.create<Message>(
          'messages',
          messageData
        );
        if (!savedMessageResult.success) {
          throw savedMessageResult.error;
        }
        const savedMessage = savedMessageResult.data;

        // 2. Extract main content for preview
        const mainContent = extractMainContentForPreview(message.content);

        // 3. Generate preview text (truncate to match original trigger logic)
        let previewText = mainContent || message.content; // Use original content if extraction fails
        if (previewText.length > 100) {
          previewText = previewText.substring(0, 100) + '...';
        }

        // 4. Update conversation preview (in the same transaction)
        const conversationUpdateResult = await dataService.update(
          'conversations',
          message.conversation_id,
          {
            last_message_preview: previewText,
            updated_at: new Date().toISOString(),
          }
        );

        if (!conversationUpdateResult.success) {
          console.warn(
            '[MessageService] Failed to update conversation preview:',
            conversationUpdateResult.error
          );
          // Do not throw error, since the message has already been saved
        }

        // 5. Clear related cache
        cacheService.deletePattern(
          `conversation:messages:${message.conversation_id}:*`
        );

        return savedMessage;
      });
    } else {
      // For non-assistant messages, use the original logic, no impact on existing functionality
      const result = await dataService.create<Message>('messages', messageData);

      if (result.success) {
        cacheService.deletePattern(
          `conversation:messages:${message.conversation_id}:*`
        );
      }

      return result;
    }
  }

  /**
   * Batch save messages
   */
  async saveMessages(
    messages: Array<{
      conversation_id: string;
      user_id?: string | null;
      role: 'user' | 'assistant' | 'system';
      content: string;
      metadata?: Record<string, unknown>;
      status?: MessageStatus;
      external_id?: string | null;
      token_count?: number | null;
      sequence_index?: number;
    }>
  ): Promise<Result<string[]>> {
    if (!messages.length) {
      return success([]);
    }

    return dataService.query(async () => {
      const messageData = messages.map(msg => ({
        ...msg,
        metadata: msg.metadata || {},
        status: msg.status || 'sent',
        is_synced: true,
        sequence_index:
          msg.sequence_index !== undefined
            ? msg.sequence_index
            : msg.role === 'user'
              ? 0
              : 1,
      }));

      const columns = [
        'conversation_id',
        'user_id',
        'role',
        'content',
        'metadata',
        'status',
        'external_id',
        'token_count',
        'is_synced',
        'sequence_index',
      ] as const;

      const params: unknown[] = [];
      const valueRows: string[] = [];
      messageData.forEach(msg => {
        const rowValues = [
          msg.conversation_id,
          msg.user_id ?? null,
          msg.role,
          msg.content,
          JSON.stringify(msg.metadata),
          msg.status,
          msg.external_id ?? null,
          msg.token_count ?? null,
          msg.is_synced,
          msg.sequence_index,
        ];

        const placeholderStart = params.length + 1;
        rowValues.forEach(value => params.push(value));
        valueRows.push(
          `(${rowValues
            .map((_, index) => `$${placeholderStart + index}`)
            .join(', ')})`
        );
      });

      const sql = `
        INSERT INTO messages (${columns.join(', ')})
        VALUES ${valueRows.join(', ')}
        RETURNING id
      `;
      const pool = getPgPool();
      const queryResult = await pool.query<{ id: string }>(sql, params);

      // Clear related cache
      const conversationIds = new Set(messages.map(m => m.conversation_id));
      conversationIds.forEach(convId => {
        cacheService.deletePattern(`conversation:messages:${convId}:*`);
      });

      return queryResult.rows.map(item => item.id);
    });
  }

  /**
   * Update message status
   */
  async updateMessageStatus(
    messageId: string,
    status: MessageStatus
  ): Promise<Result<Message>> {
    const result = await dataService.update<Message>('messages', messageId, {
      status,
    });

    // Clear related cache (need to get the message's conversation_id first)
    if (result.success) {
      const message = result.data;
      cacheService.deletePattern(
        `conversation:messages:${message.conversation_id}:*`
      );
    }

    return result;
  }

  /**
   * Convert a frontend ChatMessage to a database Message
   */
  chatMessageToDbMessage(
    chatMessage: ChatMessage,
    conversationId: string,
    userId?: string | null
  ): Omit<Message, 'id' | 'created_at' | 'is_synced'> {
    const baseMetadata = chatMessage.metadata || {};

    // Add manual stop flag
    if (chatMessage.wasManuallyStopped && !baseMetadata.stopped_manually) {
      baseMetadata.stopped_manually = true;
      baseMetadata.stopped_at =
        baseMetadata.stopped_at || new Date().toISOString();
    }

    // Add attachments info
    if (chatMessage.attachments && chatMessage.attachments.length > 0) {
      baseMetadata.attachments = chatMessage.attachments;
    }

    // sequence_index is a direct field, not in metadata anymore
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

  /**
   * Convert a database Message to a frontend ChatMessage
   */
  dbMessageToChatMessage(dbMessage: Message): ChatMessage {
    // Extract attachments from metadata
    const attachments = dbMessage.metadata?.attachments || [];

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

  /**
   * Find duplicate message (for deduplication)
   */
  async findDuplicateMessage(
    content: string,
    role: 'user' | 'assistant' | 'system',
    conversationId: string
  ): Promise<Result<Message | null>> {
    return dataService.findOne<Message>(
      'messages',
      {
        conversation_id: conversationId,
        role,
        content,
      },
      { cache: true, cacheTTL: 30 * 1000 } // 30 seconds cache
    );
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
    return dataService.query(async () => {
      // Get total count
      const totalResult = await dataService.count('messages', {
        conversation_id: conversationId,
      });
      if (!totalResult.success) {
        throw totalResult.error;
      }

      const pool = getPgPool();
      const roleStatsResult = await pool.query<{
        role: string;
        total: number;
      }>(
        `
          SELECT role, COUNT(*)::int AS total
          FROM messages
          WHERE conversation_id = $1
          GROUP BY role
        `,
        [conversationId]
      );
      const byRole: Record<string, number> = {};
      roleStatsResult.rows.forEach(item => {
        byRole[item.role] = Number(item.total || 0);
      });

      const lastMessageResult = await pool.query<{ created_at: Date | string }>(
        `
          SELECT created_at
          FROM messages
          WHERE conversation_id = $1
          ORDER BY created_at DESC, sequence_index DESC, id DESC
          LIMIT 1
        `,
        [conversationId]
      );
      const lastMessage = lastMessageResult.rows[0];
      const lastMessageAt = lastMessage
        ? lastMessage.created_at instanceof Date
          ? lastMessage.created_at.toISOString()
          : String(lastMessage.created_at)
        : undefined;

      return {
        total: totalResult.data,
        byRole,
        lastMessageAt,
      };
    });
  }

  /**
   * Clear message cache
   */
  clearMessageCache(conversationId?: string): number {
    if (conversationId) {
      return cacheService.deletePattern(
        `conversation:messages:${conversationId}:*`
      );
    } else {
      return cacheService.deletePattern('conversation:messages:*');
    }
  }
}

// Export singleton instance
export const messageService = MessageService.getInstance();
