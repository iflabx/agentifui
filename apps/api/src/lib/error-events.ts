import { createHash } from 'node:crypto';

import type { ApiErrorDetail } from './app-error';
import { queryRowsWithPgSystemContext } from './pg-context';

const CONTEXT_REDACT_PATTERN =
  /(password|secret|token|key|authorization|cookie)/i;
const MAX_CONTEXT_DEPTH = 3;

function sanitizeContextValue(value: unknown, depth: number): unknown {
  if (depth > MAX_CONTEXT_DEPTH) {
    return '[truncated]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map(item => sanitizeContextValue(item, depth + 1));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const source = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(source)) {
    if (CONTEXT_REDACT_PATTERN.test(key)) {
      sanitized[key] = '[redacted]';
      continue;
    }
    sanitized[key] = sanitizeContextValue(inner, depth + 1);
  }
  return sanitized;
}

function sanitizeContext(
  context: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!context) {
    return {};
  }
  return sanitizeContextValue(context, 0) as Record<string, unknown>;
}

function buildFingerprint(input: {
  code: string;
  source: string;
  route?: string;
  method?: string;
  message: string;
}): string {
  const normalizedMessage = input.message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,36}/gi, '{uuid}')
    .replace(/\b\d{6,}\b/g, '{num}')
    .slice(0, 400);
  const raw = [
    input.code,
    input.source,
    (input.route || '').toLowerCase(),
    (input.method || '').toUpperCase(),
    normalizedMessage,
  ].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

export async function recordApiErrorEvent(input: {
  detail: ApiErrorDetail;
  statusCode?: number;
  method?: string;
  route?: string;
  actorUserId?: string;
}): Promise<void> {
  const detail = input.detail;
  const method = (input.method || '').trim().toUpperCase() || null;
  const route = (input.route || '').trim() || null;
  const actorUserId = (input.actorUserId || '').trim() || null;
  const contextJson = sanitizeContext(detail.context);
  const fingerprint = buildFingerprint({
    code: detail.code,
    source: detail.source,
    route: route || undefined,
    method: method || undefined,
    message: detail.userMessage,
  });

  await queryRowsWithPgSystemContext(
    `
      INSERT INTO error_events (
        fingerprint,
        code,
        source,
        severity,
        retryable,
        user_message,
        developer_message,
        http_status,
        method,
        route,
        request_id,
        actor_user_id,
        context_json,
        first_seen_at,
        last_seen_at,
        occurrence_count,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13::jsonb, NOW(), NOW(), 1, NOW(), NOW()
      )
      ON CONFLICT (fingerprint) DO UPDATE SET
        severity = EXCLUDED.severity,
        retryable = EXCLUDED.retryable,
        user_message = EXCLUDED.user_message,
        developer_message = COALESCE(EXCLUDED.developer_message, error_events.developer_message),
        http_status = COALESCE(EXCLUDED.http_status, error_events.http_status),
        method = COALESCE(EXCLUDED.method, error_events.method),
        route = COALESCE(EXCLUDED.route, error_events.route),
        request_id = EXCLUDED.request_id,
        actor_user_id = COALESCE(EXCLUDED.actor_user_id, error_events.actor_user_id),
        context_json = EXCLUDED.context_json,
        last_seen_at = NOW(),
        occurrence_count = error_events.occurrence_count + 1,
        updated_at = NOW()
    `,
    [
      fingerprint,
      detail.code,
      detail.source,
      detail.severity,
      detail.retryable,
      detail.userMessage,
      detail.developerMessage || null,
      input.statusCode || null,
      method,
      route,
      detail.requestId,
      actorUserId,
      JSON.stringify(contextJson),
    ]
  );
}
