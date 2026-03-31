/** @jest-environment node */
import { toUserFacingAgentError } from './agent-error';

describe('agent-error moderation overrides', () => {
  it('maps blocked moderation errors to a dedicated user-facing message', () => {
    expect(
      toUserFacingAgentError({
        source: 'dify-proxy',
        status: 400,
        code: 'CONTENT_MODERATION_BLOCKED',
        message: 'Input moderation blocked the request.',
        locale: 'zh-CN',
      })
    ).toMatchObject({
      code: 'CONTENT_MODERATION_BLOCKED',
      userMessage: '您的消息未通过审查，请修改后重试。',
      retryable: true,
    });
  });

  it('maps unavailable moderation errors to a dedicated user-facing message', () => {
    expect(
      toUserFacingAgentError({
        source: 'dify-proxy',
        status: 503,
        code: 'CONTENT_MODERATION_UNAVAILABLE',
        message: 'Input moderation is unavailable.',
        locale: 'en-US',
      })
    ).toMatchObject({
      code: 'CONTENT_MODERATION_UNAVAILABLE',
      userMessage:
        'The content moderation service is temporarily unavailable. Please try again later.',
      retryable: true,
    });
  });
});
