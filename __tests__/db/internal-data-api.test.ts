import { callInternalDataAction } from '@lib/db/internal-data-api';

describe('internal-data-api callInternalDataAction', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns success payload on 200 response', async () => {
    const response = {
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        success: true,
        data: { id: 'abc' },
      }),
    } as unknown as Response;
    (global.fetch as jest.Mock).mockResolvedValueOnce(response);

    const result = await callInternalDataAction<{ id: string }>(
      'conversations.createConversation',
      { title: 'hello' }
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('Expected success result');
    }
    expect(result.data).toEqual({ id: 'abc' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry when upstream returns server error', async () => {
    const response = {
      ok: false,
      status: 500,
      json: jest.fn().mockResolvedValue({
        success: false,
        error: 'Internal error',
      }),
    } as unknown as Response;
    (global.fetch as jest.Mock).mockResolvedValueOnce(response);

    const result = await callInternalDataAction(
      'conversations.createConversation',
      { title: 'hello' }
    );

    expect(result.success).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry on network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNRESET'));

    const result = await callInternalDataAction(
      'conversations.createConversation',
      { title: 'hello' }
    );

    expect(result.success).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
