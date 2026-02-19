import { getPgPool } from '../pg-context';
import { publishRealtimeEvent } from './broker';
import {
  type RealtimeEventType,
  type RealtimeRow,
  deriveRealtimeKeysForTableChange,
} from './contract';

const OUTBOX_TABLE = 'realtime_outbox_events';
const OUTBOX_DISPATCHER_STATE_KEY =
  '__agentifui_fastify_realtime_outbox_dispatcher__';
const OUTBOX_DISPATCHER_DISABLED_WARN_KEY =
  '__agentifui_fastify_realtime_outbox_dispatcher_disabled_warn__';

interface OutboxRow {
  id: number;
  schema_name: string;
  table_name: string;
  event_type: string;
  commit_timestamp: string | Date;
  new_row: RealtimeRow | null;
  old_row: RealtimeRow | null;
  attempt_count: number;
}

interface DispatcherState {
  started: boolean;
  startPromise: Promise<void> | null;
  draining: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
  tableMissingBackoffUntil: number;
  tableMissingWarned: boolean;
}

function parseBooleanEnv(
  value: string | undefined,
  fallbackValue: boolean
): boolean {
  if (!value) {
    return fallbackValue;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallbackValue;
}

function hasRedisConfig(): boolean {
  return Boolean(
    process.env.REDIS_URL?.trim() || process.env.REDIS_HOST?.trim()
  );
}

function warnDispatcherDisabledOnce(reason: string): void {
  const globalState = globalThis as unknown as Record<string, unknown>;
  if (globalState[OUTBOX_DISPATCHER_DISABLED_WARN_KEY] === reason) {
    return;
  }
  globalState[OUTBOX_DISPATCHER_DISABLED_WARN_KEY] = reason;
  console.warn(`[FastifyRealtimeOutbox] dispatcher disabled: ${reason}`);
}

function isOutboxDispatcherEnabled(): boolean {
  if (!parseBooleanEnv(process.env.REALTIME_OUTBOX_ENABLED, true)) {
    return false;
  }
  if ((process.env.NODE_ENV || '').trim().toLowerCase() === 'test') {
    return false;
  }
  if (!hasRedisConfig()) {
    warnDispatcherDisabledOnce('REDIS_URL/REDIS_HOST is not configured');
    return false;
  }
  return true;
}

function getOutboxDrainBatchSize(): number {
  const parsed = Number(process.env.REALTIME_OUTBOX_DRAIN_BATCH || 200);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 200;
  }
  return Math.floor(Math.min(1000, parsed));
}

function getOutboxPollIntervalMs(): number {
  const parsed = Number(process.env.REALTIME_OUTBOX_POLL_MS || 250);
  if (!Number.isFinite(parsed) || parsed < 100) {
    return 250;
  }
  return Math.floor(parsed);
}

function getOutboxMissingTableBackoffMs(): number {
  const parsed = Number(
    process.env.REALTIME_OUTBOX_MISSING_TABLE_BACKOFF_MS || 30000
  );
  if (!Number.isFinite(parsed) || parsed < 1000) {
    return 30000;
  }
  return Math.floor(parsed);
}

function getOutboxRetryBaseDelayMs(): number {
  const parsed = Number(process.env.REALTIME_OUTBOX_RETRY_BASE_MS || 1000);
  if (!Number.isFinite(parsed) || parsed < 100) {
    return 1000;
  }
  return Math.floor(parsed);
}

function computeRetryDelayMs(attemptCount: number): number {
  const baseDelay = getOutboxRetryBaseDelayMs();
  const exponent = Math.max(0, Math.min(6, attemptCount));
  return baseDelay * Math.pow(2, exponent);
}

function getDispatcherState(): DispatcherState {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[OUTBOX_DISPATCHER_STATE_KEY] as
    | DispatcherState
    | undefined;
  if (existing) {
    return existing;
  }

  const created: DispatcherState = {
    started: false,
    startPromise: null,
    draining: false,
    pollTimer: null,
    tableMissingBackoffUntil: 0,
    tableMissingWarned: false,
  };
  globalState[OUTBOX_DISPATCHER_STATE_KEY] = created;
  return created;
}

function isMissingOutboxTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code === '42P01';
}

function toRealtimeEventType(value: string): RealtimeEventType | null {
  if (value === 'INSERT' || value === 'UPDATE' || value === 'DELETE') {
    return value;
  }
  return null;
}

function normalizeRealtimeRow(value: unknown): RealtimeRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as RealtimeRow;
}

async function claimOutboxBatch(limit: number): Promise<OutboxRow[]> {
  const pool = getPgPool();
  const sql = `
    WITH picked AS (
      SELECT id
      FROM ${OUTBOX_TABLE}
      WHERE available_at <= NOW()
      ORDER BY id
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    ),
    deleted AS (
      DELETE FROM ${OUTBOX_TABLE} e
      USING picked p
      WHERE e.id = p.id
      RETURNING
        e.id,
        e.schema_name,
        e.table_name,
        e.event_type,
        e.commit_timestamp,
        e.new_row,
        e.old_row,
        e.attempt_count
    )
    SELECT *
    FROM deleted
    ORDER BY id
  `;

  const { rows } = await pool.query<OutboxRow>(sql, [limit]);
  return rows;
}

async function requeueOutboxRow(row: OutboxRow): Promise<void> {
  const pool = getPgPool();
  const nextAttempt = Math.max(0, Number(row.attempt_count || 0)) + 1;
  const retryDelayMs = computeRetryDelayMs(nextAttempt);
  const availableAt = new Date(Date.now() + retryDelayMs).toISOString();

  await pool.query(
    `
      INSERT INTO ${OUTBOX_TABLE} (
        schema_name,
        table_name,
        event_type,
        commit_timestamp,
        new_row,
        old_row,
        attempt_count,
        available_at
      ) VALUES (
        $1::text,
        $2::text,
        $3::text,
        $4::timestamptz,
        $5::jsonb,
        $6::jsonb,
        $7::integer,
        $8::timestamptz
      )
    `,
    [
      row.schema_name,
      row.table_name,
      row.event_type,
      row.commit_timestamp,
      row.new_row,
      row.old_row,
      nextAttempt,
      availableAt,
    ]
  );
}

async function processOutboxRow(row: OutboxRow): Promise<void> {
  const eventType = toRealtimeEventType(row.event_type);
  if (!eventType) {
    return;
  }

  const payload = {
    schema: row.schema_name || 'public',
    table: row.table_name,
    eventType,
    commitTimestamp: new Date(row.commit_timestamp).toISOString(),
    new: normalizeRealtimeRow(row.new_row),
    old: normalizeRealtimeRow(row.old_row),
  };
  const keys = deriveRealtimeKeysForTableChange({
    table: payload.table,
    newRow: payload.new,
    oldRow: payload.old,
  });

  for (const key of keys) {
    await publishRealtimeEvent({ key, payload });
  }
}

async function drainOutboxEvents(): Promise<void> {
  const state = getDispatcherState();
  if (state.draining) {
    return;
  }
  if (Date.now() < state.tableMissingBackoffUntil) {
    return;
  }

  state.draining = true;
  try {
    const rows = await claimOutboxBatch(getOutboxDrainBatchSize());
    state.tableMissingWarned = false;
    state.tableMissingBackoffUntil = 0;

    for (const row of rows) {
      try {
        await processOutboxRow(row);
      } catch (error) {
        console.warn(
          `[FastifyRealtimeOutbox] failed to process row ${row.id}, requeueing:`,
          error
        );
        await requeueOutboxRow(row).catch(requeueError => {
          console.warn(
            `[FastifyRealtimeOutbox] failed to requeue row ${row.id}:`,
            requeueError
          );
        });
      }
    }
  } catch (error) {
    if (isMissingOutboxTableError(error)) {
      state.tableMissingBackoffUntil =
        Date.now() + getOutboxMissingTableBackoffMs();
      if (!state.tableMissingWarned) {
        state.tableMissingWarned = true;
        console.warn(
          `[FastifyRealtimeOutbox] table ${OUTBOX_TABLE} is missing; retrying with backoff`
        );
      }
      return;
    }

    console.error('[FastifyRealtimeOutbox] drain failed:', error);
  } finally {
    state.draining = false;
  }
}

export function ensureRealtimeOutboxDispatcher(): void {
  if (!isOutboxDispatcherEnabled()) {
    return;
  }

  const state = getDispatcherState();
  if (state.started) {
    return;
  }
  if (state.startPromise) {
    return;
  }

  state.startPromise = (async () => {
    await drainOutboxEvents();
    if (!state.pollTimer) {
      state.pollTimer = setInterval(() => {
        void drainOutboxEvents();
      }, getOutboxPollIntervalMs());
    }
    state.started = true;
  })()
    .catch(error => {
      state.started = false;
      console.error('[FastifyRealtimeOutbox] failed to start:', error);
    })
    .finally(() => {
      state.startPromise = null;
    });
}
