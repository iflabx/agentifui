import type { AppErrorSource } from '@lib/errors/app-error';
import {
  type UiError,
  formatUiErrorMessage,
  toUiError,
} from '@lib/errors/ui-error';
import { reportClientError } from '@lib/services/client/error-reporting';

import type { ChatSubmitResult } from './types';

export const CONTENT_MODERATION_BLOCKED_CODE = 'CONTENT_MODERATION_BLOCKED';
export const CONTENT_MODERATION_UNAVAILABLE_CODE =
  'CONTENT_MODERATION_UNAVAILABLE';

type ModerationTranslationKey =
  | 'blocked'
  | 'blockedWithCategories'
  | 'unavailable';

type ModerationTranslationValues = {
  categories?: string;
};

export type ChatModerationTranslator = (
  key: ModerationTranslationKey,
  values?: ModerationTranslationValues
) => string;

function normalizeModerationCategories(value: unknown): string[] {
  const normalizeCategoryItem = (item: string): string =>
    item
      .trim()
      .replace(/^categories?\s*:\s*/i, '')
      .replace(/^[\s"'`[{(]+/, '')
      .replace(/[\s"'`\]})\].,;:!?\u3002\uff1b\uff1a\uff01\uff1f]+$/, '')
      .trim();

  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeCategoryItem)
      .filter(item => item.length > 0 && item.toLowerCase() !== 'none');
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(normalizeCategoryItem)
      .filter(item => item.length > 0 && item.toLowerCase() !== 'none');
  }

  return [];
}

function extractCategoriesFromDeveloperMessage(message?: string): string[] {
  if (!message) {
    return [];
  }

  const match = message.match(/categories:\s*(.+?)(?:\n|$)/i);
  return match ? normalizeModerationCategories(match[1]) : [];
}

function resolveModerationCategories(
  error: Pick<UiError, 'developerMessage' | 'context'>
): string[] {
  const fromContext = normalizeModerationCategories(
    error.context?.moderation_categories
  );
  if (fromContext.length > 0) {
    return fromContext;
  }

  return extractCategoriesFromDeveloperMessage(error.developerMessage);
}

export function localizeChatModerationMessage(
  error: Pick<UiError, 'code' | 'developerMessage' | 'context'>,
  moderationT?: ChatModerationTranslator
): string | null {
  if (!moderationT) {
    return null;
  }

  if (error.code === CONTENT_MODERATION_BLOCKED_CODE) {
    const categories = resolveModerationCategories(error);
    if (categories.length > 0) {
      return moderationT('blockedWithCategories', {
        categories: categories.join(', '),
      });
    }

    return moderationT('blocked');
  }

  if (error.code === CONTENT_MODERATION_UNAVAILABLE_CODE) {
    return moderationT('unavailable');
  }

  return null;
}

export function formatChatUiError(
  error: unknown,
  fallbackMessage: string,
  fallbackSource: AppErrorSource,
  options: {
    moderationT?: ChatModerationTranslator;
  } = {}
): { errorMessage: string; errorCode?: string; requestId?: string } {
  const uiError = toUiError(error, fallbackMessage, fallbackSource);
  const localizedModerationMessage = localizeChatModerationMessage(
    uiError,
    options.moderationT
  );
  return {
    errorMessage: localizedModerationMessage || formatUiErrorMessage(uiError),
    errorCode: uiError.code,
    requestId: uiError.requestId,
  };
}

export function buildChatSubmitResult(
  input: Omit<ChatSubmitResult, 'ok'> & { ok?: boolean }
): ChatSubmitResult {
  return {
    ok: input.ok ?? false,
    surfaced: input.surfaced,
    errorMessage: input.errorMessage,
    errorCode: input.errorCode,
    requestId: input.requestId,
  };
}

export function isContentModerationBlocked(code?: string): boolean {
  return code === CONTENT_MODERATION_BLOCKED_CODE;
}

export function isKnownModerationError(code?: string): boolean {
  return (
    code === CONTENT_MODERATION_BLOCKED_CODE ||
    code === CONTENT_MODERATION_UNAVAILABLE_CODE
  );
}

export async function reportTraceableClientError(input: {
  code: string;
  userMessage: string;
  developerMessage?: string;
  requestId?: string;
  route?: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  await reportClientError({
    code: input.code,
    userMessage: input.userMessage,
    developerMessage: input.developerMessage,
    requestId: input.requestId,
    route: input.route,
    context: input.context,
    severity: 'error',
    retryable: true,
  });
}
