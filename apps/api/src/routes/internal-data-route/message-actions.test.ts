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
