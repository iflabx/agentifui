import { getPgPool } from '@lib/server/pg/pool';
import { resolvePgSessionOptionsFromEnv } from '@lib/server/pg/session-options';
import {
  type RealtimeDbChangePayload,
  type RealtimeEventType,
  type RealtimeRow,
  deriveRealtimeKeysForTableChange,
} from '@lib/services/db/realtime-service';
import { Client, type ClientConfig } from 'pg';

import { publishRealtimeEvent } from './redis-broker';

const OUTBOX_DISPATCHER_STATE_KEY = '__agentifui_realtime_outbox_dispatcher__';
const OUTBOX_DISPATCHER_DISABLED_WARN_KEY =
  '__agentifui_realtime_outbox_dispatcher_disabled_warn__';
const DEFAULT_NOTIFY_CHANNEL = 'agentifui_realtime_outbox';
const OUTBOX_TABLE = 'realtime_outbox_events';
const CHANNEL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

type OutboxRow = {
  id: number;
  schema_name: string;
  table_name: string;
  event_type: string;
  commit_timestamp: string | Date;
  new_row: RealtimeRow | null;
  old_row: RealtimeRow | null;
  attempt_count: number;
};

type DispatcherState = {
  started: boolean;
  startPromise: Promise<void> | null;
  draining: boolean;
  listener: Client | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  tableMissingBackoffUntil: number;
  tableMissingWarned: boolean;
};

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

function isServerRuntime(): boolean {
  return typeof window === 'undefined';
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
  console.warn(`[RealtimeOutbox] dispatcher disabled: ${reason}`);
}

function isOutboxDispatcherEnabled(): boolean {
  if (!isServerRuntime()) {
    return false;
  }
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

function resolveDatabaseUrl(): string {
  const primary = process.env.DATABASE_URL?.trim();
  if (primary) {
    return primary;
  }

  const fallback = process.env.PGURL?.trim();
  if (fallback) {
    return fallback;
  }

  throw new Error('DATABASE_URL (or PGURL) is required');
}

function getOutboxNotifyChannel(): string {
  const configured =
    process.env.REALTIME_OUTBOX_NOTIFY_CHANNEL?.trim() ||
    DEFAULT_NOTIFY_CHANNEL;
  if (!CHANNEL_IDENTIFIER.test(configured)) {
    return DEFAULT_NOTIFY_CHANNEL;
  }
  return configured;
}

function getOutboxDrainBatchSize(): number {
  const parsed = Number(process.env.REALTIME_OUTBOX_DRAIN_BATCH || 200);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 200;
  }
  return Math.floor(Math.min(1000, parsed));
}

function getOutboxPollIntervalMs(): number {
  const parsed = Number(process.env.REALTIME_OUTBOX_POLL_MS || 1500);
  if (!Number.isFinite(parsed) || parsed < 200) {
    return 1500;
  }
  return Math.floor(parsed);
}

function getOutboxRestartDelayMs(): number {
  const parsed = Number(process.env.REALTIME_OUTBOX_RESTART_MS || 3000);
  if (!Number.isFinite(parsed) || parsed < 500) {
    return 3000;
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

function parseOutboxId(payload: string | undefined): number | null {
  const parsed = Number(String(payload || '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
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
    listener: null,
    pollTimer: null,
    restartTimer: null,
    tableMissingBackoffUntil: 0,
    tableMissingWarned: false,
  };
  globalState[OUTBOX_DISPATCHER_STATE_KEY] = created;
  return created;
}

async function closeListener(state: DispatcherState): Promise<void> {
  const listener = state.listener;
  state.listener = null;
  if (!listener) {
    return;
  }

  try {
    await listener.end();
  } catch {
    // best-effort
  }
}

function scheduleRestart(state: DispatcherState): void {
  if (state.restartTimer) {
    return;
  }

  state.started = false;
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  void closeListener(state);

  state.restartTimer = setTimeout(() => {
    state.restartTimer = null;
    ensureRealtimeOutboxDispatcher();
  }, getOutboxRestartDelayMs());
}

async function createListenerClient(state: DispatcherState): Promise<Client> {
  if (state.listener) {
    return state.listener;
  }

  const sessionOptions = resolvePgSessionOptionsFromEnv();
  const clientConfig: ClientConfig = {
    connectionString: resolveDatabaseUrl(),
    ...(sessionOptions ? { options: sessionOptions } : {}),
  };
  const listener = new Client(clientConfig);

  listener.on('error', error => {
    console.warn('[RealtimeOutbox] listener error:', error);
    scheduleRestart(state);
  });

  listener.on('end', () => {
    scheduleRestart(state);
  });

  listener.on('notification', message => {
    if (message.channel !== getOutboxNotifyChannel()) {
      return;
    }

    const id = parseOutboxId(message.payload || undefined);
    if (id) {
      void drainOutboxEvents([id]);
      return;
    }

    void drainOutboxEvents();
  });

  await listener.connect();
  await listener.query(`LISTEN ${getOutboxNotifyChannel()}`);

  state.listener = listener;
  return listener;
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

async function claimOutboxByIds(ids: number[]): Promise<OutboxRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const pool = getPgPool();
  const sql = `
    WITH picked AS (
      SELECT id
      FROM ${OUTBOX_TABLE}
      WHERE id = ANY($1::bigint[])
        AND available_at <= NOW()
      ORDER BY id
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

  const { rows } = await pool.query<OutboxRow>(sql, [ids]);
  return rows;
}

async function requeueOutboxRows(rows: OutboxRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const pool = getPgPool();
  for (const row of rows) {
    const nextAttempt = Math.max(0, Number(row.attempt_count || 0)) + 1;
    const availableAt = new Date(Date.now() + computeRetryDelayMs(nextAttempt));
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
        )
        VALUES (
          $1,
          $2,
          $3,
          $4::timestamptz,
          $5::jsonb,
          $6::jsonb,
          $7,
          $8::timestamptz
        )
      `,
      [
        row.schema_name,
        row.table_name,
        row.event_type,
        new Date(row.commit_timestamp).toISOString(),
        JSON.stringify(row.new_row ?? null),
        JSON.stringify(row.old_row ?? null),
        nextAttempt,
        availableAt.toISOString(),
      ]
    );
  }
}

async function publishOutboxRow(row: OutboxRow): Promise<boolean> {
  const eventType = toRealtimeEventType(String(row.event_type));
  if (!eventType) {
    return true;
  }

  const payload: RealtimeDbChangePayload = {
    schema: String(row.schema_name || 'public'),
    table: String(row.table_name || ''),
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

  if (keys.length === 0) {
    return true;
  }

  try {
    await Promise.all(
      keys.map(async key => {
        await publishRealtimeEvent({ key, payload });
      })
    );
    return true;
  } catch (error) {
    console.warn('[RealtimeOutbox] publish failed, scheduling retry:', {
      id: row.id,
      table: payload.table,
      eventType: payload.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function drainOutboxEvents(targetIds?: number[]): Promise<void> {
  const state = getDispatcherState();
  if (state.draining) {
    return;
  }
  if (Date.now() < state.tableMissingBackoffUntil) {
    return;
  }

  state.draining = true;
  try {
    const batchSize = getOutboxDrainBatchSize();
    const ids = Array.isArray(targetIds)
      ? targetIds.filter(id => Number.isFinite(id) && id > 0)
      : [];

    let keepDraining = true;
    while (keepDraining) {
      const rows =
        ids.length > 0
          ? await claimOutboxByIds(ids)
          : await claimOutboxBatch(batchSize);

      if (rows.length === 0) {
        break;
      }

      const failedRows: OutboxRow[] = [];
      for (const row of rows) {
        const ok = await publishOutboxRow(row);
        if (!ok) {
          failedRows.push(row);
        }
      }

      await requeueOutboxRows(failedRows);

      if (ids.length > 0 || rows.length < batchSize) {
        keepDraining = false;
      }
    }

    state.tableMissingWarned = false;
    state.tableMissingBackoffUntil = 0;
  } catch (error) {
    const sqlState = (
      error && typeof error === 'object' && 'code' in error
        ? String(error.code || '')
        : ''
    ) as string;
    if (sqlState === '42P01') {
      if (!state.tableMissingWarned) {
        console.warn(
          '[RealtimeOutbox] outbox table is missing; dispatcher will retry later'
        );
        state.tableMissingWarned = true;
      }
      state.tableMissingBackoffUntil =
        Date.now() + getOutboxMissingTableBackoffMs();
      return;
    }

    state.tableMissingWarned = false;
    console.warn('[RealtimeOutbox] drain failed:', error);
  } finally {
    state.draining = false;
  }
}

async function startRealtimeOutboxDispatcher(): Promise<void> {
  if (!isServerRuntime()) {
    return;
  }

  const state = getDispatcherState();
  await createListenerClient(state);
  await drainOutboxEvents();

  if (!state.pollTimer) {
    state.pollTimer = setInterval(() => {
      void drainOutboxEvents();
    }, getOutboxPollIntervalMs());
  }

  state.started = true;
}

export function ensureRealtimeOutboxDispatcher(): void {
  if (!isOutboxDispatcherEnabled()) {
    return;
  }

  const state = getDispatcherState();
  if (state.started || state.startPromise) {
    return;
  }

  state.startPromise = startRealtimeOutboxDispatcher()
    .catch(error => {
      console.warn('[RealtimeOutbox] failed to start dispatcher:', error);
      scheduleRestart(state);
    })
    .finally(() => {
      state.startPromise = null;
    });
}
