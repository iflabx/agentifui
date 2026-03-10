import type { AppErrorSeverity, AppErrorSource } from '@lib/errors/app-error';
import { getRedisManager } from '@lib/infra/redis/manager';
import { getPgPool } from '@lib/server/pg/pool';
import { createHash } from 'node:crypto';
import 'server-only';

import { appendErrorEventMirror } from './error-event-mirror';

export interface RecordErrorEventInput {
  code: string;
  source: AppErrorSource;
  severity: AppErrorSeverity;
  retryable: boolean;
  userMessage: string;
  developerMessage?: string;
  requestId: string;
  traceId?: string;
  actorUserId?: string;
  httpStatus?: number;
  method?: string;
  route?: string;
  context?: Record<string, unknown>;
}

export interface ErrorEventListItem {
  id: string;
  fingerprint: string;
  code: string;
  source: string;
  severity: AppErrorSeverity;
  retryable: boolean;
  user_message: string;
  developer_message: string | null;
  http_status: number | null;
  method: string | null;
  route: string | null;
  request_id: string;
  trace_id: string | null;
  actor_user_id: string | null;
  context_json: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  created_at: string;
  updated_at: string;
}

interface ErrorSummaryRow {
  total_unique: string;
  total_occurrences: string;
  critical_count: string;
  error_count: string;
  warn_count: string;
  latest_at: string | null;
}

export interface ErrorEventSummary {
  totalUnique: number;
  totalOccurrences: number;
  criticalCount: number;
  errorCount: number;
  warnCount: number;
  latestAt: string | null;
}

const REDIS_ERROR_STREAM_KEY = 'errors:ingest';
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

  const record = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(record)) {
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

function normalizeText(value: string | undefined): string {
  return (value || '').trim().slice(0, 2000);
}

function buildFingerprint(input: {
  code: string;
  source: string;
  route?: string;
  method?: string;
  userMessage: string;
}): string {
  const normalizedMessage = input.userMessage
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

async function publishToRedisStream(
  payload: RecordErrorEventInput,
  fingerprint: string
): Promise<void> {
  try {
    const manager = getRedisManager();
    const client = await manager.getClient();
    await client.xAdd(
      manager.buildKey(REDIS_ERROR_STREAM_KEY),
      '*',
      {
        code: payload.code,
        source: payload.source,
        severity: payload.severity,
        request_id: payload.requestId,
        fingerprint,
      },
      {
        TRIM: {
          strategy: 'MAXLEN',
          strategyModifier: '~',
          threshold: 20000,
        },
      }
    );
  } catch (error) {
    console.warn(
      '[ErrorEvents] Redis stream publish failed:',
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function recordErrorEvent(
  input: RecordErrorEventInput
): Promise<void> {
  const userMessage = normalizeText(input.userMessage) || 'Unknown error';
  const developerMessage = normalizeText(input.developerMessage);
  const method = normalizeText(input.method).toUpperCase() || null;
  const route = normalizeText(input.route) || null;
  const traceId = normalizeText(input.traceId) || null;
  const actorUserId = normalizeText(input.actorUserId) || null;
  const contextJson = sanitizeContext(input.context);
  const fingerprint = buildFingerprint({
    code: input.code,
    source: input.source,
    route: route || undefined,
    method: method || undefined,
    userMessage,
  });

  await appendErrorEventMirror({
    runtime: 'next',
    fingerprint,
    code: input.code,
    source: input.source,
    severity: input.severity,
    retryable: input.retryable,
    userMessage,
    developerMessage: developerMessage || null,
    httpStatus: input.httpStatus || null,
    method,
    route,
    requestId: input.requestId,
    traceId,
    actorUserId,
    contextJson,
  });

  await publishToRedisStream(input, fingerprint);

  const pool = getPgPool();
  await pool.query(
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
        trace_id,
        actor_user_id,
        context_json,
        first_seen_at,
        last_seen_at,
        occurrence_count,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14::jsonb, NOW(), NOW(), 1, NOW(), NOW()
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
        trace_id = COALESCE(EXCLUDED.trace_id, error_events.trace_id),
        actor_user_id = COALESCE(EXCLUDED.actor_user_id, error_events.actor_user_id),
        context_json = EXCLUDED.context_json,
        last_seen_at = NOW(),
        occurrence_count = error_events.occurrence_count + 1,
        updated_at = NOW()
    `,
    [
      fingerprint,
      input.code,
      input.source,
      input.severity,
      input.retryable,
      userMessage,
      developerMessage || null,
      input.httpStatus || null,
      method,
      route,
      input.requestId,
      traceId,
      actorUserId,
      JSON.stringify(contextJson),
    ]
  );
}

export async function getRecentErrorEvents(
  limit: number,
  offset: number
): Promise<ErrorEventListItem[]> {
  const normalizedLimit = Math.min(Math.max(Math.floor(limit || 50), 1), 200);
  const normalizedOffset = Math.max(Math.floor(offset || 0), 0);
  const pool = getPgPool();
  const { rows } = await pool.query<ErrorEventListItem>(
    `
      SELECT
        id,
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
        trace_id,
        actor_user_id,
        context_json,
        first_seen_at,
        last_seen_at,
        occurrence_count,
        created_at,
        updated_at
      FROM error_events
      ORDER BY last_seen_at DESC
      LIMIT $1
      OFFSET $2
    `,
    [normalizedLimit, normalizedOffset]
  );
  return rows;
}

export async function getErrorEventSummary(
  hours: number
): Promise<ErrorEventSummary> {
  const normalizedHours = Math.min(Math.max(Math.floor(hours || 24), 1), 720);
  const pool = getPgPool();
  const { rows } = await pool.query<ErrorSummaryRow>(
    `
      SELECT
        COUNT(*)::text AS total_unique,
        COALESCE(SUM(occurrence_count), 0)::text AS total_occurrences,
        COUNT(*) FILTER (WHERE severity = 'critical')::text AS critical_count,
        COUNT(*) FILTER (WHERE severity = 'error')::text AS error_count,
        COUNT(*) FILTER (WHERE severity = 'warn')::text AS warn_count,
        MAX(last_seen_at)::text AS latest_at
      FROM error_events
      WHERE last_seen_at >= NOW() - ($1::text || ' hours')::interval
    `,
    [normalizedHours]
  );

  const summary = rows[0];
  return {
    totalUnique: Number(summary?.total_unique || 0),
    totalOccurrences: Number(summary?.total_occurrences || 0),
    criticalCount: Number(summary?.critical_count || 0),
    errorCount: Number(summary?.error_count || 0),
    warnCount: Number(summary?.warn_count || 0),
    latestAt: summary?.latest_at || null,
  };
}
