/** @jest-environment node */
import {
  deleteConversation,
  getConversationVariables,
  getConversations,
} from './conversation-service';

describe('Dify conversation Service API contracts', () => {
  afterEach(() => jest.restoreAllMocks());

  it('accepts the official empty 204 deletion response without parsing JSON', async () => {
    const json = jest
      .fn()
      .mockRejectedValue(new SyntaxError('Unexpected end of JSON input'));
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 204,
      json,
    } as unknown as Response);
    await expect(
      deleteConversation('app-1', 'conversation-1', { user: 'user-1' })
    ).resolves.toEqual({ result: 'success' });
    expect(json).not.toHaveBeenCalled();
  });

  it('retains compatibility with JSON deletion responses', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: 'success' }),
    } as Response);
    await expect(
      deleteConversation('app-1', 'conversation-1', { user: 'user-1' })
    ).resolves.toEqual({ result: 'success' });
  });

  it('does not turn a rejected deletion into success', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        code: 'not_found',
        message: 'Conversation missing',
      }),
    } as Response);
    await expect(
      deleteConversation('app-1', 'conversation-1', { user: 'user-1' })
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('omits an empty first-page cursor instead of sending an invalid UUID', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, limit: 20 }),
    } as Response);
    await getConversations('app-1', { user: 'user-1', last_id: '', limit: 20 });
    const url = new URL(
      String(fetchMock.mock.calls[0][0]),
      'https://client.example.com'
    );
    expect(url.searchParams.has('last_id')).toBe(false);
    expect(url.searchParams.get('user')).toBe('user-1');
  });

  it('omits empty conversation-variable cursors as well', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, limit: 20 }),
    } as Response);
    await getConversationVariables('app-1', 'conversation-1', {
      user: 'user-1',
      last_id: '',
    });
    const url = new URL(
      String(fetchMock.mock.calls[0][0]),
      'https://client.example.com'
    );
    expect(url.searchParams.has('last_id')).toBe(false);
  });
});
