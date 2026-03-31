import type { AppErrorDetail, AppErrorSource } from './app-error';
import { AppRequestError, extractAppErrorDetail } from './app-error';

export interface UiError {
  code: string;
  source: AppErrorSource;
  retryable: boolean;
  message: string;
  requestId?: string;
  developerMessage?: string;
  context?: Record<string, unknown>;
}

function buildUiErrorFromDetail(
  detail: AppErrorDetail,
  fallbackMessage: string,
  messageOverride?: string
): UiError {
  return {
    code: detail.code,
    source: detail.source,
    retryable: detail.retryable,
    message: detail.userMessage || messageOverride || fallbackMessage,
    ...(detail.requestId ? { requestId: detail.requestId } : {}),
    ...(detail.developerMessage
      ? { developerMessage: detail.developerMessage }
      : {}),
    ...(detail.context ? { context: detail.context } : {}),
  };
}

function extractDetailFromErrorLike(error: Error): AppErrorDetail | null {
  const detailCandidate = (
    error as Error & {
      detail?: unknown;
      cause?: unknown;
    }
  ).detail;

  if (detailCandidate) {
    const detail = extractAppErrorDetail({
      app_error: detailCandidate,
    });
    if (detail) {
      return detail;
    }
  }

  return extractAppErrorDetail((error as Error & { cause?: unknown }).cause);
}

export function toUiError(
  error: unknown,
  fallbackMessage: string,
  fallbackSource: AppErrorSource = 'frontend'
): UiError {
  if (error instanceof AppRequestError) {
    if (error.detail) {
      return buildUiErrorFromDetail(
        error.detail,
        fallbackMessage,
        error.message
      );
    }

    return {
      code: 'REQUEST_FAILED',
      source: fallbackSource,
      retryable: error.status >= 500 || error.status === 429,
      message: error.message || fallbackMessage,
    };
  }

  if (error instanceof Error) {
    const detail = extractDetailFromErrorLike(error);
    if (detail) {
      return buildUiErrorFromDetail(detail, fallbackMessage, error.message);
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
