/** @jest-environment node */
import {
  buildConversationCreateInput,
  buildConversationUpdateInput,
  buildMessageCreateInput,
  getMessagePreviewText,
  normalizeExternalId,
} from '@lib/db/conversations/helpers';

describe('conversation helpers', () => {
  it('applies defaults to conversation and message payloads', () => {
    expect(
      buildConversationCreateInput({
        user_id: 'u1',
        title: 'Demo',
        summary: null,
        ai_config_id: null,
        app_id: '',
        external_id: '',
        settings: {},
        status: 'active',
        last_message_preview: '',
      })
    ).toMatchObject({
      app_id: null,
      external_id: null,
      last_message_preview: null,
    });

    expect(
      buildMessageCreateInput({
        conversation_id: 'c1',
        role: 'user',
        content: 'hello',
        metadata: {},
        status: 'sent',
        external_id: '',
        token_count: undefined,
      } as never)
    ).toMatchObject({
      external_id: null,
      token_count: null,
      is_synced: true,
    });
  });

  it('builds update payloads and preview text', () => {
    expect(buildConversationUpdateInput({ title: 'Updated' })).toMatchObject({
      title: 'Updated',
    });
    expect(getMessagePreviewText('a'.repeat(120))).toHaveLength(100);
  });

  it('normalizes external ids', () => {
    expect(normalizeExternalId('  dify-1  ')).toBe('dify-1');
    expect(normalizeExternalId('   ')).toBeNull();
  });
});
