const SECRET_FIELD =
  /password|secret|token|authorization|cookie|api.?key|^code$|^state$/i;
const CONTEXT_FIELDS = new Set([
  'pathname',
  'route',
  'filename',
  'lineno',
  'colno',
  'language',
  'eventType',
  'report_origin',
  'server_received_at',
  'status',
  'statusCode',
  'httpStatus',
  'source',
  'code',
  'retryable',
  'phase',
  'stage',
  'method',
  'backendType',
  'appType',
  'operation',
  'action',
  'durationMs',
  'attempt',
  'messageLength',
  'agent_kind',
  'agent_source',
  'requestId',
  'traceId',
  'conversationId',
  'runId',
  'appId',
  'saveStatus',
]);

export function safeDiagnosticRoute(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    let text = value.trim().slice(0, 4000);
    for (let pass = 0; pass < 2 && /%[0-9a-f]{2}/i.test(text); pass += 1) {
      text = decodeURIComponent(text);
    }
    const pathname = new URL(text, 'https://diagnostic.invalid').pathname;
    return pathname
      .replace(
        /(\/(?:reset-password|verify-email|magic-link|callback|invite|invitation))(?:\/[^/]+)+/gi,
        '$1/[redacted]'
      )
      .replace(/[^/]*@[^/]+/g, '[redacted]')
      .slice(0, 500);
  } catch {
    return '[redacted-route]';
  }
}

export function sanitizeDiagnosticText(value: unknown): string {
  if (typeof value !== 'string') return '';
  let text = value.slice(0, 8000);
  for (let pass = 0; pass < 2; pass += 1) {
    text = text.replace(/(?:%[0-9a-f]{2})+/gi, encoded => {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return '[redacted-encoding]';
      }
    });
    text = text.replace(
      /(?:https?|redis|postgres(?:ql)?):(?:\/\/|%3a|%2f)[^\s<>"']*/gi,
      url => safeDiagnosticRoute(url)
    );
    text = text.replace(/\b(?:https?%3a%2f%2f)[^\s<>"']*/gi, url =>
      safeDiagnosticRoute(url)
    );
    text = text.replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]');
    text = text.replace(
      /\b(?:set-cookie|cookie|authorization)["']?\s*[:=]\s*[^\r\n]+/gi,
      '[redacted-header]'
    );
    text = text.replace(
      /\b(?:password|passwd|(?:client[_-]?)?secret|(?:access[_-]?|refresh[_-]?|id[_-]?|reset[_-]?|session[_-]?|auth[_-]?)?token(?:_hash)?|api[_-]?key|code|state)["']?\s*(?:=|:|%3d)\s*(?:"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s&;,"'}]+)/gi,
      '[redacted]'
    );
    text = text.replace(/(\/[A-Za-z0-9_./%~-]+)\?[^\s<>"']*/g, '$1');
    text = text.replace(
      /\/(?:reset-password|verify-email|magic-link|callback|invite|invitation)\/[^\s<>"']+/gi,
      route => safeDiagnosticRoute(route)
    );
  }
  return text.trim().slice(0, 2000);
}

export function sanitizeDiagnosticContext(
  value: unknown
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, unknown> = {};
  for (const field of Object.keys(value).slice(0, 100)) {
    if (!CONTEXT_FIELDS.has(field)) continue;
    const entry = (value as Record<string, unknown>)[field];
    if (SECRET_FIELD.test(field) && field !== 'code') continue;
    if (typeof entry === 'string') {
      result[field] = ['pathname', 'route', 'filename'].includes(field)
        ? safeDiagnosticRoute(entry)
        : sanitizeDiagnosticText(entry).slice(0, 500);
    } else if (
      typeof entry === 'boolean' ||
      entry === null ||
      (typeof entry === 'number' && Number.isFinite(entry))
    ) {
      result[field] = entry;
    }
  }
  return result;
}

export function sanitizeDiagnosticEvent<
  T extends {
    code: string;
    userMessage: string;
    developerMessage?: string | null;
    requestId: string;
    traceId?: string | null;
    route?: string | null;
    method?: string | null;
    context?: Record<string, unknown>;
  },
>(input: T): T {
  return {
    ...input,
    code: sanitizeDiagnosticText(input.code).slice(0, 100),
    userMessage: sanitizeDiagnosticText(input.userMessage) || 'Unknown error',
    developerMessage: sanitizeDiagnosticText(input.developerMessage),
    requestId: sanitizeDiagnosticText(input.requestId).slice(0, 160),
    traceId: sanitizeDiagnosticText(input.traceId).slice(0, 160),
    method: sanitizeDiagnosticText(input.method).slice(0, 20),
    route: safeDiagnosticRoute(input.route),
    context: sanitizeDiagnosticContext(input.context),
  };
}
