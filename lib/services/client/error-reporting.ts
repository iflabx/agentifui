import type { AppErrorSeverity } from '@lib/errors/app-error';

export interface ClientErrorReportInput {
  code: string;
  userMessage: string;
  developerMessage?: string;
  severity?: AppErrorSeverity;
  retryable?: boolean;
  requestId?: string;
  traceId?: string;
  httpStatus?: number;
  method?: string;
  route?: string;
  context?: Record<string, unknown>;
  preferBeacon?: boolean;
}

const ENDPOINT = '/api/internal/error-events/client';
const DEDUPE_WINDOW_MS = 5000;
const recentReports = new Map<string, number>();

function sanitizeText(value: string | undefined, fallbackValue: string): string {
  const normalized = (value || '').trim();
  return (normalized || fallbackValue).slice(0, 4000);
}

function shouldReport(key: string): boolean {
  const now = Date.now();

  for (const [entryKey, timestamp] of recentReports.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentReports.delete(entryKey);
    }
  }

  const previousTimestamp = recentReports.get(key);
  if (previousTimestamp && now - previousTimestamp < DEDUPE_WINDOW_MS) {
    return false;
  }

  recentReports.set(key, now);
  return true;
}

function buildPayload(input: ClientErrorReportInput): Record<string, unknown> {
  const pathname =
    typeof window !== 'undefined' ? window.location.pathname : undefined;
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const href = typeof window !== 'undefined' ? window.location.href : undefined;
  const userAgent =
    typeof navigator !== 'undefined' ? navigator.userAgent : undefined;
  const language =
    typeof navigator !== 'undefined' ? navigator.language : undefined;

  return {
    code: sanitizeText(input.code, 'CLIENT_RUNTIME_ERROR'),
    userMessage: sanitizeText(input.userMessage, 'Unexpected client error'),
    developerMessage: input.developerMessage
      ? sanitizeText(input.developerMessage, input.userMessage)
      : undefined,
    severity: input.severity || 'error',
    retryable: typeof input.retryable === 'boolean' ? input.retryable : true,
    requestId: input.requestId,
    traceId: input.traceId,
    httpStatus: input.httpStatus,
    method: input.method || 'CLIENT',
    route: input.route || pathname || '/client',
    context: {
      pathname,
      search,
      href,
      userAgent,
      language,
      ...input.context,
    },
  };
}

export async function reportClientError(
  input: ClientErrorReportInput
): Promise<boolean> {
  const payload = buildPayload(input);
  const dedupeKey = [
    payload.code,
    payload.userMessage,
    payload.route,
  ].join('|');

  if (!shouldReport(dedupeKey)) {
    return false;
  }

  const body = JSON.stringify(payload);

  if (
    input.preferBeacon !== false &&
    typeof navigator !== 'undefined' &&
    typeof navigator.sendBeacon === 'function'
  ) {
    const accepted = navigator.sendBeacon(
      ENDPOINT,
      new Blob([body], { type: 'application/json' })
    );

    if (accepted) {
      return true;
    }
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      cache: 'no-store',
      keepalive: true,
      body,
    });
    return response.ok;
  } catch {
    return false;
  }
}
