import type { AppErrorSource } from './app-error';
import { AppRequestError, extractAppErrorDetail } from './app-error';

export interface UiError {
  code: string;
  source: AppErrorSource;
  retryable: boolean;
  message: string;
  requestId?: string;
}

export function toUiError(
  error: unknown,
  fallbackMessage: string,
  fallbackSource: AppErrorSource = 'frontend'
): UiError {
  if (error instanceof AppRequestError) {
    if (error.detail) {
      return {
        code: error.detail.code,
        source: error.detail.source,
        retryable: error.detail.retryable,
        message: error.detail.userMessage || error.message || fallbackMessage,
        ...(error.detail.requestId
          ? { requestId: error.detail.requestId }
          : {}),
      };
    }

    return {
      code: 'REQUEST_FAILED',
      source: fallbackSource,
      retryable: error.status >= 500 || error.status === 429,
      message: error.message || fallbackMessage,
    };
  }

  if (error instanceof Error) {
    const detail = extractAppErrorDetail(
      (error as unknown as { cause?: unknown }).cause
    );
    if (detail) {
      return {
        code: detail.code,
        source: detail.source,
        retryable: detail.retryable,
        message: detail.userMessage || error.message || fallbackMessage,
        ...(detail.requestId ? { requestId: detail.requestId } : {}),
      };
    }

    return {
      code: 'REQUEST_FAILED',
      source: fallbackSource,
      retryable: true,
      message: error.message || fallbackMessage,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    source: fallbackSource,
    retryable: true,
    message: fallbackMessage,
  };
}

export function formatUiErrorMessage(error: UiError): string {
  const debugParts = [`Code: ${error.code}`];

  if (error.requestId) {
    debugParts.push(`Request ID: ${error.requestId}`);
  }

  return `${error.message} (${debugParts.join(', ')})`;
}
