/** @jest-environment node */
import { clearConversationMessagesCache } from '../../../../../lib/services/db/message-service/cache';
import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import { loadConversationOwnedByActor } from './auth';
import { handleMessageAction } from './message-actions';

jest.mock('../../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
}));

jest.mock('./auth', () => ({
  loadConversationOwnedByActor: jest.fn(),
}));

jest.mock('../../../../../lib/services/db/message-service/cache', () => ({
  clearConversationMessagesCache: jest.fn(),
}));

describe('handleMessageAction cache invalidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (loadConversationOwnedByActor as jest.Mock).mockResolvedValue({
      id: 'conv-1',
    });
  });

  it('clears conversation message cache after metadata updates', async () => {
    (queryRowsWithPgSystemContext as jest.Mock).mockResolvedValueOnce([
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        user_id: null,
        role: 'assistant',
        content: '<think>draft</think>',
        metadata: {
          stopped_manually: true,
        },
        created_at: '2026-04-05T00:00:00.000Z',
        status: 'sent',
        external_id: null,
        token_count: null,
        is_synced: true,
        sequence_index: 1,
      },
    ]);

    const result = await handleMessageAction(
      'messages.updateMetadata',
      {
        conversationId: 'conv-1',
        messageId: 'msg-1',
        metadata: {
          stopped_manually: true,
        },
      },
      'user-1'
    );

    expect((result?.payload as { success?: boolean })?.success).toBe(true);
    expect(clearConversationMessagesCache).toHaveBeenCalledWith('conv-1');
  });
});
