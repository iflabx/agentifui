import { Message, MessageStatus } from '@lib/types/database';
import { Result, success } from '@lib/types/result';
import { extractMainContentForPreview } from '@lib/utils/index';

import { dataService } from '../data-service';
import {
  clearConversationMessageCaches,
  clearConversationMessagesCache,
} from './cache';
import { publishMessageChangeBestEffort } from './realtime';
import type { SaveMessageInput } from './types';

function normalizeSequenceIndex(
  role: SaveMessageInput['role'],
  sequenceIndex: number | undefined
) {
  if (sequenceIndex !== undefined) {
    return sequenceIndex;
  }

  return role === 'user' ? 0 : 1;
}

function toSavedMessageData(message: SaveMessageInput) {
  return {
    ...message,
    metadata: message.metadata || {},
    status: message.status || 'sent',
    is_synced: true,
    sequence_index: normalizeSequenceIndex(
      message.role,
      message.sequence_index
    ),
  };
}

function buildPreviewText(content: string): string {
  const mainContent = extractMainContentForPreview(content);
  let previewText = mainContent || content;
  if (previewText.length > 100) {
    previewText = previewText.substring(0, 100) + '...';
  }
  return previewText;
}

export async function saveMessage(
  message: SaveMessageInput
): Promise<Result<Message>> {
  const messageData = toSavedMessageData(message);

  if (message.role === 'assistant') {
    return dataService.query(async () => {
      const savedMessageResult = await dataService.create<Message>(
        'messages',
        messageData
      );
      if (!savedMessageResult.success) {
        throw savedMessageResult.error;
      }
      const savedMessage = savedMessageResult.data;

      const conversationUpdateResult = await dataService.update(
        'conversations',
        message.conversation_id,
        {
          last_message_preview: buildPreviewText(message.content),
          updated_at: new Date().toISOString(),
        }
      );

      if (!conversationUpdateResult.success) {
        console.warn(
          '[MessageService] Failed to update conversation preview:',
          conversationUpdateResult.error
        );
      }

      clearConversationMessagesCache(message.conversation_id);
      return savedMessage;
    });
  }

  const result = await dataService.create<Message>('messages', messageData);

  if (result.success) {
    clearConversationMessagesCache(message.conversation_id);
  }

  return result;
}

export async function saveMessages(
  messages: SaveMessageInput[]
): Promise<Result<string[]>> {
  if (!messages.length) {
    return success([]);
  }

  return dataService.query(async () => {
    const messageData = messages.map(toSavedMessageData);

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
    const queryResult = await dataService.rawQuery<{ id: string }>(sql, params);
    if (!queryResult.success) {
      throw queryResult.error;
    }

    const conversationIds = new Set(messages.map(m => m.conversation_id));
    clearConversationMessageCaches(conversationIds);

    await Promise.all(
      Array.from(conversationIds).map(async conversationId => {
        await publishMessageChangeBestEffort({
          eventType: 'INSERT',
          oldRow: null,
          newRow: {
            conversation_id: conversationId,
          },
        });
      })
    );

    return queryResult.data.map(item => item.id);
  });
}

export async function updateMessageStatus(
  messageId: string,
  status: MessageStatus
): Promise<Result<Message>> {
  const result = await dataService.update<Message>('messages', messageId, {
    status,
  });

  if (result.success) {
    clearConversationMessagesCache(result.data.conversation_id);
  }

  return result;
}

export async function findDuplicateMessage(
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
    { cache: true, cacheTTL: 30 * 1000 }
  );
}
