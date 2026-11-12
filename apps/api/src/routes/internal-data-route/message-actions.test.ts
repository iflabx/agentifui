/** @jest-environment node */
import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import { loadConversationOwnedByActor } from './auth';
import { handleMessageAction } from './message-actions';

jest.mock('../../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
}));
jest.mock('./auth', () => ({ loadConversationOwnedByActor: jest.fn() }));

describe('message identity lookup', () => {
  const payload = {
    conversationId: 'conversation-1',
    content: 'same question',
    role: 'user',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (loadConversationOwnedByActor as jest.Mock).mockResolvedValue({
      id: 'conversation-1',
    });
    (queryRowsWithPgSystemContext as jest.Mock).mockResolvedValue([]);
  });

  it('requires an authenticated actor', async () => {
    const response = await handleMessageAction(
      'messages.findDuplicate',
      payload,
      undefined
    );
    expect(response?.statusCode).toBe(401);
    expect(loadConversationOwnedByActor).not.toHaveBeenCalled();
    expect(queryRowsWithPgSystemContext).not.toHaveBeenCalled();
  });

  it('does not let a client message identity bypass conversation ownership', async () => {
    (loadConversationOwnedByActor as jest.Mock).mockResolvedValue(null);
    const response = await handleMessageAction(
      'messages.findDuplicate',
      { ...payload, clientMessageId: 'message-1' },
      'user-1'
    );
    expect(response?.statusCode).toBe(404);
    expect(loadConversationOwnedByActor).toHaveBeenCalledWith(
      'conversation-1',
      'user-1'
    );
    expect(queryRowsWithPgSystemContext).not.toHaveBeenCalled();
  });

  it('uses message identity instead of merging repeated content', async () => {
    const response = await handleMessageAction(
      'messages.findDuplicate',
      { ...payload, clientMessageId: 'message-2' },
      'user-1'
    );
    expect(response?.payload).toEqual({ success: true, data: null });
    expect(queryRowsWithPgSystemContext).toHaveBeenCalledWith(
      expect.stringContaining(
        "($4::text IS NOT NULL AND metadata ->> 'client_message_id' = $4)"
      ),
      ['conversation-1', 'user', 'same question', 'message-2']
    );
    expect(queryRowsWithPgSystemContext).toHaveBeenCalledWith(
      expect.stringContaining('($4::text IS NULL AND content = $3)'),
      expect.any(Array)
    );
  });

  it('preserves content lookup for legacy callers without an identity', async () => {
    await handleMessageAction('messages.findDuplicate', payload, 'user-1');
    expect(queryRowsWithPgSystemContext).toHaveBeenCalledWith(
      expect.any(String),
      ['conversation-1', 'user', 'same question', null]
    );
  });
});

describe('conversation message pages', () => {
  const conversationId = '00000000-0000-4000-8000-000000000001';
  const cursorId = '00000000-0000-4000-8000-000000000002';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(loadConversationOwnedByActor).mockResolvedValue(true);
    jest.mocked(queryRowsWithPgSystemContext).mockResolvedValue([]);
  });

  it('selects the newest window while retaining the legacy array response', async () => {
    jest
      .mocked(queryRowsWithPgSystemContext)
      .mockResolvedValue([{ id: 'newest' }, { id: 'previous' }] as never);
    const response = await handleMessageAction(
      'messages.getLatest',
      { conversationId, limit: 2 },
      'actor'
    );
    expect(response?.payload).toMatchObject({
      success: true,
      data: [{ id: 'previous' }, { id: 'newest' }],
    });
    expect(queryRowsWithPgSystemContext).toHaveBeenCalledWith(
      expect.stringContaining(
        'ORDER BY created_at DESC, COALESCE(sequence_index, 0) DESC, id DESC'
      ),
      [conversationId, 2, null]
    );
  });

  it('uses a probe row for hasMore and returns the oldest displayed id as cursor', async () => {
    jest
      .mocked(queryRowsWithPgSystemContext)
      .mockResolvedValue([
        { id: 'newest' },
        { id: cursorId },
        { id: 'probe' },
      ] as never);
    const response = await handleMessageAction(
      'messages.getPage',
      { conversationId, limit: 2 },
      'actor'
    );
    expect(response?.payload).toMatchObject({
      success: true,
      data: {
        messages: [{ id: cursorId }, { id: 'newest' }],
        hasMore: true,
        nextCursor: cursorId,
      },
    });
    expect(queryRowsWithPgSystemContext).toHaveBeenCalledWith(
      expect.any(String),
      [conversationId, 3, null]
    );
  });

  it('does not advertise more for an exactly full final page', async () => {
    jest
      .mocked(queryRowsWithPgSystemContext)
      .mockResolvedValue([{ id: 'last' }] as never);
    const response = await handleMessageAction(
      'messages.getPage',
      { conversationId, limit: 1 },
      'actor'
    );
    expect(response?.payload).toMatchObject({
      data: { hasMore: false, nextCursor: null },
    });
  });

  it('keeps cursor lookup inside the owned conversation and includes the sequence tie-breaker', async () => {
    await handleMessageAction(
      'messages.getPage',
      { conversationId, beforeMessageId: cursorId },
      'actor'
    );
    expect(queryRowsWithPgSystemContext).toHaveBeenCalledWith(
      expect.stringContaining(
        '(created_at, COALESCE(sequence_index, 0), id) < ('
      ),
      [conversationId, 21, cursorId]
    );
    expect(queryRowsWithPgSystemContext).toHaveBeenCalledWith(
      expect.stringContaining(
        'WHERE conversation_id = $1::uuid AND id = $3::uuid'
      ),
      expect.any(Array)
    );
  });

  it('rejects malformed cursors and caps pages to 100 messages', async () => {
    for (const beforeMessageId of ['invalid', '', null, 12, {}]) {
      const response = await handleMessageAction(
        'messages.getPage',
        { conversationId, beforeMessageId },
        'actor'
      );
      expect(response?.statusCode).toBe(400);
    }
    expect(queryRowsWithPgSystemContext).not.toHaveBeenCalled();
    await handleMessageAction(
      'messages.getPage',
      { conversationId, limit: 5000 },
      'actor'
    );
    expect(queryRowsWithPgSystemContext).toHaveBeenCalledWith(
      expect.any(String),
      [conversationId, 101, null]
    );
  });

  it('requires authentication and ownership for the new action', async () => {
    expect(
      (
        await handleMessageAction(
          'messages.getPage',
          { conversationId },
          undefined
        )
      )?.statusCode
    ).toBe(401);
    jest.mocked(loadConversationOwnedByActor).mockResolvedValue(false);
    expect(
      (
        await handleMessageAction(
          'messages.getPage',
          { conversationId },
          'other'
        )
      )?.statusCode
    ).toBe(404);
    expect(queryRowsWithPgSystemContext).not.toHaveBeenCalled();
  });
});
