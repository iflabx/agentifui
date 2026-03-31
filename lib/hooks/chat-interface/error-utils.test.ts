import { AppRequestError } from '@lib/errors/app-error';

import {
  CONTENT_MODERATION_BLOCKED_CODE,
  CONTENT_MODERATION_UNAVAILABLE_CODE,
  formatChatUiError,
  isContentModerationBlocked,
  localizeChatModerationMessage,
} from './error-utils';

const moderationT = (
  key: 'blocked' | 'blockedWithCategories' | 'unavailable',
  values?: { categories?: string }
) => {
  switch (key) {
    case 'blocked':
      return 'blocked-localized';
    case 'blockedWithCategories':
      return `blocked-localized:${values?.categories ?? ''}`;
    case 'unavailable':
      return 'unavailable-localized';
  }
};

describe('chat-interface error utils', () => {
  it('detects content moderation blocked errors', () => {
    expect(isContentModerationBlocked(CONTENT_MODERATION_BLOCKED_CODE)).toBe(
      true
    );
    expect(isContentModerationBlocked('REQUEST_FAILED')).toBe(false);
    expect(isContentModerationBlocked(undefined)).toBe(false);
  });

  it('localizes blocked moderation errors with categories from context', () => {
    const error = new AppRequestError('blocked', 400, {
      code: CONTENT_MODERATION_BLOCKED_CODE,
      source: 'dify-proxy',
      severity: 'error',
      retryable: false,
      userMessage: 'backend blocked',
      requestId: 'req-1',
      occurredAt: '2026-03-31T00:00:00.000Z',
      context: {
        moderation_categories: ['Violent'],
      },
    });

    expect(
      formatChatUiError(error, 'fallback', 'frontend', { moderationT })
    ).toEqual({
      errorMessage: 'blocked-localized:Violent',
      errorCode: CONTENT_MODERATION_BLOCKED_CODE,
      requestId: 'req-1',
    });
  });

  it('localizes blocked moderation errors from error-like objects with detail payloads', () => {
    const error = new Error('backend blocked') as Error & {
      detail: {
        code: string;
        source: 'dify-proxy';
        severity: 'error';
        retryable: boolean;
        userMessage: string;
        developerMessage: string;
        requestId: string;
        occurredAt: string;
        context: {
          moderation_categories: string[];
        };
      };
    };
    error.detail = {
      code: CONTENT_MODERATION_BLOCKED_CODE,
      source: 'dify-proxy',
      severity: 'error',
      retryable: false,
      userMessage: 'backend blocked',
      developerMessage:
        'Input moderation blocked the request. Categories: Violent',
      requestId: 'req-foreign',
      occurredAt: '2026-03-31T00:00:00.000Z',
      context: {
        moderation_categories: ['Violent'],
      },
    };

    expect(
      formatChatUiError(error, 'fallback', 'frontend', { moderationT })
    ).toEqual({
      errorMessage: 'blocked-localized:Violent',
      errorCode: CONTENT_MODERATION_BLOCKED_CODE,
      requestId: 'req-foreign',
    });
  });

  it('sanitizes moderation categories before localizing them', () => {
    expect(
      localizeChatModerationMessage(
        {
          code: CONTENT_MODERATION_BLOCKED_CODE,
          developerMessage:
            'Input moderation blocked the request. Categories: "Violent"}.',
          context: {
            moderation_categories: [' "Violent"}'],
          },
        },
        moderationT
      )
    ).toBe('blocked-localized:Violent');
  });

  it('localizes blocked moderation errors with categories parsed from developer text', () => {
    expect(
      localizeChatModerationMessage(
        {
          code: CONTENT_MODERATION_BLOCKED_CODE,
          developerMessage:
            'Input moderation blocked the request. Categories: Violent, hate_speech',
        },
        moderationT
      )
    ).toBe('blocked-localized:Violent, hate_speech');
  });

  it('localizes unavailable moderation errors', () => {
    expect(
      localizeChatModerationMessage(
        {
          code: CONTENT_MODERATION_UNAVAILABLE_CODE,
        },
        moderationT
      )
    ).toBe('unavailable-localized');
  });
});
