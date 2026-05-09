/** @jest-environment node */
import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import { handleConversationAction } from './conversation-actions';

jest.mock('../../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
}));

const mockQueryRowsWithPgSystemContext =
  queryRowsWithPgSystemContext as jest.MockedFunction<
    typeof queryRowsWithPgSystemContext
  >;

describe('handleConversationAction generated title sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates generated title only for placeholder titles', async () => {
    mockQueryRowsWithPgSystemContext.mockResolvedValueOnce([{ id: 'conv-1' }]);

    const response = await handleConversationAction(
      'conversations.syncGeneratedTitleIfPlaceholder',
      {
        conversationId: 'conv-1',
        title: 'Generated title',
        placeholderTitles: ['Creating...', '创建中...', 'Creating...'],
      },
      'user-1'
    );

    expect(response).toMatchObject({ statusCode: 200 });
    expect(response?.payload).toEqual({ success: true, data: true });
    expect(mockQueryRowsWithPgSystemContext).toHaveBeenCalledWith(
      expect.stringContaining('title = ANY($4::text[])'),
      ['Generated title', 'conv-1', 'user-1', ['Creating...', '创建中...']]
    );
    expect(mockQueryRowsWithPgSystemContext).toHaveBeenCalledWith(
      expect.stringContaining(
        "updated_at = updated_at + interval '1 microsecond'"
      ),
      expect.any(Array)
    );
  });

  it('returns false when the current title is not a placeholder', async () => {
    mockQueryRowsWithPgSystemContext.mockResolvedValueOnce([]);

    const response = await handleConversationAction(
      'conversations.syncGeneratedTitleIfPlaceholder',
      {
        conversationId: 'conv-1',
        title: 'Generated title',
        placeholderTitles: ['Creating...'],
      },
      'user-1'
    );

    expect(response?.payload).toEqual({ success: true, data: false });
  });

  it('rejects missing placeholder candidates', async () => {
    const response = await handleConversationAction(
      'conversations.syncGeneratedTitleIfPlaceholder',
      {
        conversationId: 'conv-1',
        title: 'Generated title',
        placeholderTitles: [],
      },
      'user-1'
    );

    expect(response).toMatchObject({ statusCode: 400 });
    expect(mockQueryRowsWithPgSystemContext).not.toHaveBeenCalled();
  });
});
