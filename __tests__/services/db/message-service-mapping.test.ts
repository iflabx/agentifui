/** @jest-environment node */
import {
  chatMessageToDbMessage,
  dbMessageToChatMessage,
} from '@lib/services/db/message-service/mapping';
import type { ChatMessage } from '@lib/stores/chat-store';
import type { Message } from '@lib/types/database';

describe('message service mapping helpers', () => {
  it('maps chat message to db message with stop metadata and attachments', () => {
    const input: ChatMessage = {
      id: 'local-1',
      text: 'hello',
      isUser: false,
      role: 'assistant',
      wasManuallyStopped: true,
      attachments: [
        {
          id: 'file-1',
          name: 'a.txt',
          size: 12,
          type: 'text/plain',
          upload_file_id: 'upload-1',
        },
      ],
      metadata: {},
    };

    const result = chatMessageToDbMessage(input, 'conv-1', 'user-1');

    expect(result.conversation_id).toBe('conv-1');
    expect(result.user_id).toBeNull();
    expect(result.sequence_index).toBe(1);
    expect(result.metadata?.stopped_manually).toBe(true);
    expect(result.metadata?.attachments).toHaveLength(1);
  });

  it('maps db message back to chat message and ignores invalid attachments', () => {
    const input = {
      id: 'db-1',
      conversation_id: 'conv-1',
      user_id: 'user-1',
      role: 'user',
      content: 'hello',
      metadata: {
        attachments: [{ bad: true }],
        stopped_manually: true,
      },
      status: 'sent',
      external_id: 'ext-1',
      token_count: 9,
      sequence_index: 0,
      is_synced: true,
      created_at: '2026-03-25T00:00:00.000Z',
      updated_at: '2026-03-25T00:00:00.000Z',
    } as Message;

    const result = dbMessageToChatMessage(input);

    expect(result.id).toBe('db-db-1');
    expect(result.isUser).toBe(true);
    expect(result.attachments).toBeUndefined();
    expect(result.wasManuallyStopped).toBe(true);
    expect(result.dify_message_id).toBe('ext-1');
  });
});
