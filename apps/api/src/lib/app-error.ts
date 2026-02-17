export const REQUEST_ID_HEADER = 'x-request-id';

export type ApiErrorSource =
  | 'fastify-api'
  | 'internal-data'
  | 'proxy-fallback'
  | 'auth'
  | 'db';

export type ApiErrorSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface ApiErrorDetail {
  code: string;
  source: ApiErrorSource;
  severity: ApiErrorSeverity;
  retryable: boolean;
  userMessage: string;
  developerMessage?: string;
  requestId: string;
  occurredAt: string;
  context?: Record<string, unknown>;
}

interface BuildApiErrorDetailInput {
  status?: number;
  code?: string;
  source: ApiErrorSource;
  userMessage: string;
  developerMessage?: string;
  requestId: string;
  retryable?: boolean;
  severity?: ApiErrorSeverity;
  context?: Record<string, unknown>;
}

function inferSeverity(status?: number): ApiErrorSeverity {
  if (!status) {
    return 'error';
  }
  if (status >= 500) {
    return 'critical';
  }
  if (status === 429) {
    return 'warn';
  }
  if (status >= 400) {
    return 'error';
  }
  return 'info';
}

function inferRetryable(status?: number): boolean {
  if (!status) {
    return true;
  }
  if (status === 408 || status === 425 || status === 429) {
    return true;
  }
  return status >= 500;
}

function inferCode(status?: number): string {
  if (!status) {
    return 'INTERNAL_ERROR';
  }
  if (status === 400) {
    return 'BAD_REQUEST';
  }
  if (status === 401) {
    return 'AUTH_UNAUTHORIZED';
  }
  if (status === 403) {
    return 'AUTH_FORBIDDEN';
  }
  if (status === 404) {
    return 'RESOURCE_NOT_FOUND';
  }
  if (status === 409) {
    return 'STATE_CONFLICT';
  }
  if (status === 422) {
    return 'VALIDATION_FAILED';
  }
  if (status === 429) {
    return 'RATE_LIMITED';
  }
  if (status === 502) {
    return 'UPSTREAM_BAD_GATEWAY';
  }
  if (status === 503) {
    return 'SERVICE_UNAVAILABLE';
  }
  if (status === 504) {
    return 'UPSTREAM_TIMEOUT';
  }
  if (status >= 500) {
    return 'INTERNAL_ERROR';
  }
  return 'REQUEST_FAILED';
}

export function buildApiErrorDetail(
  input: BuildApiErrorDetailInput
): ApiErrorDetail {
  return {
    code: input.code || inferCode(input.status),
    source: input.source,
    severity: input.severity || inferSeverity(input.status),
    retryable:
      typeof input.retryable === 'boolean'
        ? input.retryable
        : inferRetryable(input.status),
    userMessage: input.userMessage,
    ...(input.developerMessage
      ? { developerMessage: input.developerMessage }
      : {}),
    requestId: input.requestId,
    occurredAt: new Date().toISOString(),
    ...(input.context ? { context: input.context } : {}),
  };
}

export function buildApiErrorEnvelope(
  detail: ApiErrorDetail,
  legacyMessage?: string
): {
  success: false;
  error: string;
  app_error: ApiErrorDetail;
  request_id: string;
} {
  return {
    success: false,
    error: legacyMessage || detail.userMessage,
    app_error: detail,
    request_id: detail.requestId,
  };
}

export function maybeReadLegacyError(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return '';
  }
  const maybeError = (payload as Record<string, unknown>).error;
  return typeof maybeError === 'string' ? maybeError.trim() : '';
}
