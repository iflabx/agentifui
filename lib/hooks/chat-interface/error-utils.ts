import type { AppErrorSource } from '@lib/errors/app-error';
import { formatUiErrorMessage, toUiError } from '@lib/errors/ui-error';
import { reportClientError } from '@lib/services/client/error-reporting';

import type { ChatSubmitResult } from './types';

export function formatChatUiError(
  error: unknown,
  fallbackMessage: string,
  fallbackSource: AppErrorSource
): { errorMessage: string; errorCode?: string; requestId?: string } {
  const uiError = toUiError(error, fallbackMessage, fallbackSource);
  return {
    errorMessage: formatUiErrorMessage(uiError),
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
