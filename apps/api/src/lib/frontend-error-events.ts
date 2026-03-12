import { createHash } from 'node:crypto';
import { createClient } from 'redis';

import { appendErrorEventMirror } from './error-event-mirror';
import { queryRowsWithPgSystemContext } from './pg-context';

const REDIS_ERROR_STREAM_KEY = 'errors:ingest';
const REDIS_CLIENT_KEY = '__agentifui_fastify_error_events_redis_client__';
const CONTEXT_REDACT_PATTERN =
  /(password|secret|token|key|authorization|cookie)/i;
const MAX_CONTEXT_DEPTH = 3;

type FrontendErrorSeverity = 'info' | 'warn' | 'error' | 'critical';

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

function normalizeText(value: string | undefined): string {
  return (value || '').trim().slice(0, 2000);
}

function buildFingerprint(input: {
  code: string;
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
    'frontend',
    (input.route || '').toLowerCase(),
    (input.method || '').toUpperCase(),
    normalizedMessage,
  ].join('|');

  return createHash('sha256').update(raw).digest('hex');
}

function resolveRedisUrl(): string {
  const fromPrimary = process.env.REDIS_URL?.trim();
  if (fromPrimary) {
    return fromPrimary;
  }

  const host = process.env.REDIS_HOST?.trim();
  if (!host) {
    throw new Error(
      'REDIS_URL (or REDIS_HOST) is required for frontend error event publishing'
    );
  }

  const port = process.env.REDIS_PORT?.trim() || '6379';
  const db = process.env.REDIS_DB?.trim() || '0';
  const password = process.env.REDIS_PASSWORD?.trim();
  if (password) {
    return `redis://:${encodeURIComponent(password)}@${host}:${port}/${db}`;
  }
  return `redis://${host}:${port}/${db}`;
}

function getRedisPrefix(): string {
  const prefix = process.env.REDIS_PREFIX?.trim() || 'agentifui';
  return prefix.replace(/:+$/g, '');
}

function withRedisPrefix(key: string): string {
  const normalizedKey = key.trim().replace(/^:+|:+$/g, '');
  return `${getRedisPrefix()}:${normalizedKey}`;
}

async function getRedisClient() {
  const globalState = globalThis as unknown as Record<string, unknown>;
  let client = globalState[REDIS_CLIENT_KEY] as
    | ReturnType<typeof createClient>
    | undefined;
  if (!client) {
    client = createClient({
      url: resolveRedisUrl(),
      socket: {
        connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 5000),
      },
      pingInterval: Number(process.env.REDIS_PING_INTERVAL_MS || 10000),
    });
    client.on('error', error => {
      console.warn('[FastifyFrontendErrorEvents] redis client error:', error);
    });
    globalState[REDIS_CLIENT_KEY] = client;
  }

  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

async function publishToRedisStream(input: {
  code: string;
  severity: FrontendErrorSeverity;
  requestId: string;
  fingerprint: string;
}): Promise<void> {
  try {
    const client = await getRedisClient();
    await client.xAdd(
      withRedisPrefix(REDIS_ERROR_STREAM_KEY),
      '*',
      {
        code: input.code,
        source: 'frontend',
        severity: input.severity,
        request_id: input.requestId,
        fingerprint: input.fingerprint,
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
      '[FastifyFrontendErrorEvents] Redis stream publish failed:',
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function recordFrontendErrorEvent(input: {
  code: string;
  severity: FrontendErrorSeverity;
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
}): Promise<void> {
  const userMessage = normalizeText(input.userMessage) || 'Unknown error';
  const developerMessage = normalizeText(input.developerMessage);
  const method = normalizeText(input.method).toUpperCase() || null;
  const route = normalizeText(input.route) || null;
  const traceId = normalizeText(input.traceId) || null;
  const actorUserId = normalizeText(input.actorUserId) || null;
  const contextJson = sanitizeContext(input.context);
  const fingerprint = buildFingerprint({
    code: input.code,
    route: route || undefined,
    method: method || undefined,
    userMessage,
  });

  await appendErrorEventMirror({
    runtime: 'fastify',
    fingerprint,
    code: input.code,
    source: 'frontend',
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

  await publishToRedisStream({
    code: input.code,
    severity: input.severity,
    requestId: input.requestId,
    fingerprint,
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
      'frontend',
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
