export const REQUEST_ID_HEADER = 'x-request-id';

export type AppErrorSource =
  | 'next-api'
  | 'fastify-api'
  | 'dify-proxy'
  | 'auth'
  | 'db'
  | 'redis'
  | 'storage'
  | 'frontend'
  | 'agent-generic';

export type AppErrorSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface AppErrorDetail {
  code: string;
  source: AppErrorSource;
  severity: AppErrorSeverity;
  retryable: boolean;
  userMessage: string;
  developerMessage?: string;
  requestId: string;
  traceId?: string;
  occurredAt: string;
  context?: Record<string, unknown>;
}

export interface AppErrorEnvelope {
  success: false;
  error: string;
  app_error: AppErrorDetail;
  request_id: string;
}

export interface AppSuccessEnvelope<T> {
  success: true;
  data: T;
  request_id?: string;
}

type HeaderCarrier =
  | Headers
  | Request
  | { headers?: Headers | Record<string, string> | null }
  | null
  | undefined;

interface BuildAppErrorDetailInput {
  status?: number;
  code?: string;
  source: AppErrorSource;
  userMessage: string;
  developerMessage?: string;
  requestId: string;
  traceId?: string;
  retryable?: boolean;
  severity?: AppErrorSeverity;
  context?: Record<string, unknown>;
}

function lookupHeader(
  carrier: HeaderCarrier,
  name: string
): string | undefined {
  if (!carrier) {
    return undefined;
  }

  if (typeof Request !== 'undefined' && carrier instanceof Request) {
    return carrier.headers.get(name) || undefined;
  }

  if (typeof Headers !== 'undefined' && carrier instanceof Headers) {
    return carrier.get(name) || undefined;
  }

  if (
    typeof carrier !== 'object' ||
    carrier === null ||
    !('headers' in carrier)
  ) {
    return undefined;
  }

  const candidateHeaders = (
    carrier as { headers?: Headers | Record<string, string> | null }
  ).headers;
  if (typeof Headers !== 'undefined' && candidateHeaders instanceof Headers) {
    return candidateHeaders.get(name) || undefined;
  }

  const headersObject = candidateHeaders;
  if (!headersObject || typeof headersObject !== 'object') {
    return undefined;
  }

  const lowerName = name.toLowerCase();
  const exact = (headersObject as Record<string, string>)[name];
  const lower = (headersObject as Record<string, string>)[lowerName];
  return exact || lower || undefined;
}

function inferSeverity(status?: number): AppErrorSeverity {
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
  if (status >= 500) {
    return true;
  }
  return false;
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

export function generateRequestId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function resolveRequestId(carrier?: HeaderCarrier): string {
  const fromHeader =
    lookupHeader(carrier, REQUEST_ID_HEADER) ||
    lookupHeader(carrier, 'x-requestid') ||
    lookupHeader(carrier, 'x-correlation-id');

  const normalized = fromHeader?.trim();
  if (normalized) {
    return normalized;
  }

  return generateRequestId();
}

export function buildAppErrorDetail(
  input: BuildAppErrorDetailInput
): AppErrorDetail {
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
    ...(input.traceId ? { traceId: input.traceId } : {}),
    occurredAt: new Date().toISOString(),
    ...(input.context ? { context: input.context } : {}),
  };
}

export function buildAppErrorEnvelope(
  detail: AppErrorDetail,
  legacyMessage?: string
): AppErrorEnvelope {
  return {
    success: false,
    error: legacyMessage || detail.userMessage,
    app_error: detail,
    request_id: detail.requestId,
  };
}

export function buildAppSuccessEnvelope<T>(
  data: T,
  requestId?: string
): AppSuccessEnvelope<T> {
  return requestId
    ? {
        success: true,
        data,
        request_id: requestId,
      }
    : {
        success: true,
        data,
      };
}

type UnknownPayload = Record<string, unknown>;

function asObject(payload: unknown): UnknownPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  return payload as UnknownPayload;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function extractAppErrorDetail(payload: unknown): AppErrorDetail | null {
  const objectPayload = asObject(payload);
  if (!objectPayload) {
    return null;
  }

  const appErrorPayload = asObject(objectPayload.app_error);
  if (!appErrorPayload) {
    return null;
  }

  const requestId =
    asString(appErrorPayload.requestId) ||
    asString(appErrorPayload.request_id) ||
    asString(objectPayload.request_id) ||
    generateRequestId();

  return {
    code: asString(appErrorPayload.code) || 'REQUEST_FAILED',
    source:
      (asString(appErrorPayload.source) as AppErrorSource | undefined) ||
      'frontend',
    severity:
      (asString(appErrorPayload.severity) as AppErrorSeverity | undefined) ||
      'error',
    retryable: Boolean(appErrorPayload.retryable),
    userMessage:
      asString(appErrorPayload.userMessage) ||
      asString(appErrorPayload.user_message) ||
      asString(objectPayload.error) ||
      'Request failed',
    ...(asString(appErrorPayload.developerMessage)
      ? { developerMessage: asString(appErrorPayload.developerMessage) }
      : {}),
    requestId,
    occurredAt:
      asString(appErrorPayload.occurredAt) || new Date().toISOString(),
    ...(asObject(appErrorPayload.context)
      ? { context: asObject(appErrorPayload.context) || undefined }
      : {}),
  };
}

export function extractErrorMessage(
  payload: unknown,
  fallback: string
): string {
  const appDetail = extractAppErrorDetail(payload);
  if (appDetail?.userMessage) {
    return appDetail.requestId
      ? `${appDetail.userMessage} (Request ID: ${appDetail.requestId})`
      : appDetail.userMessage;
  }

  const objectPayload = asObject(payload);
  const objectError = asString(objectPayload?.error);
  if (objectError) {
    const requestId = asString(objectPayload?.request_id);
    return requestId
      ? `${objectError} (Request ID: ${requestId})`
      : objectError;
  }

  return fallback;
}

export class AppRequestError extends Error {
  detail: AppErrorDetail | null;
  status: number;

  constructor(message: string, status: number, detail?: AppErrorDetail | null) {
    super(message);
    this.name = 'AppRequestError';
    this.status = status;
    this.detail = detail || null;
  }
}
