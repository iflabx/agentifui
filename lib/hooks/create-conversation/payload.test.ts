import {
  buildStreamingConversationPayload,
  buildTempConversationId,
} from './payload';

describe('create-conversation payload helpers', () => {
  it('creates unique temp conversation ids', () => {
    const first = buildTempConversationId();
    const second = buildTempConversationId();

    expect(first).toMatch(/^temp-/);
    expect(second).toMatch(/^temp-/);
    expect(first).not.toBe(second);
  });

  it('builds a streaming chat payload with the expected defaults', () => {
    const payload = buildStreamingConversationPayload(
      {
        query: 'hello',
        inputs: { foo: 'bar' },
        user: 'stale-user',
      },
      'user-1'
    );

    expect(payload).toEqual({
      query: 'hello',
      inputs: { foo: 'bar' },
      user: 'user-1',
      response_mode: 'streaming',
      conversation_id: null,
      auto_generate_name: false,
    });
  });
});
