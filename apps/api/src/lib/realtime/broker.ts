import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

import { getPgPool } from '../pg-context';
import type { RealtimeDbChangePayload, RealtimeEnvelope } from './contract';

type RealtimeListener = (event: RealtimeEnvelope) => void;

const BASE_REDIS_CLIENT_KEY = '__agentifui_fastify_realtime_redis_client__';
const BROKER_STATE_KEY = '__agentifui_fastify_realtime_broker__';
const BROKER_INSTANCE_ID_KEY =
  '__agentifui_fastify_realtime_broker_instance_id__';

const DEFAULT_CHANNEL = 'realtime:events';
const DEFAULT_STREAM_KEY = 'realtime:events:stream';
const METRIC_PUBLISH_FAILURE_TOTAL_KEY =
  'realtime:broker:publish:failures:total';
const METRIC_PUBLISH_FAILURE_LAST_AT_KEY =
  'realtime:broker:publish:failures:last_at';
const METRIC_PUBLISH_FAILURE_LAST_ERROR_KEY =
  'realtime:broker:publish:failures:last_error';

interface BrokerState {
  listeners: Set<RealtimeListener>;
  subscriberReady: boolean;
  subscriberInitPromise: Promise<void> | null;
  subscriber: ReturnType<typeof createClient> | null;
  publisher: ReturnType<typeof createClient> | null;
}

function parseBooleanEnv(
  value: string | undefined,
  fallbackValue: boolean
): boolean {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) {
    return fallbackValue;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallbackValue;
}

function allowLocalFallbackOnPublishFailure(): boolean {
  return parseBooleanEnv(
    process.env.REALTIME_PUBLISH_ALLOW_LOCAL_FALLBACK,
    false
  );
}

function getRedisPrefix(): string {
  const prefix = process.env.REDIS_PREFIX?.trim() || 'agentifui';
  return prefix.replace(/:+$/g, '');
}

function withRedisPrefix(key: string): string {
  const normalizedKey = key.trim().replace(/^:+|:+$/g, '');
  return `${getRedisPrefix()}:${normalizedKey}`;
}

function resolveRedisUrl(): string {
  const fromPrimary = process.env.REDIS_URL?.trim();
  if (fromPrimary) {
    return fromPrimary;
  }

  const host = process.env.REDIS_HOST?.trim();
  if (!host) {
    throw new Error(
      'REDIS_URL (or REDIS_HOST) is required for realtime broker'
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

function getChannelName(): string {
  return process.env.REALTIME_REDIS_CHANNEL?.trim() || DEFAULT_CHANNEL;
}

function getStreamKey(): string {
  return process.env.REALTIME_REDIS_STREAM_KEY?.trim() || DEFAULT_STREAM_KEY;
}

function getStreamMaxLen(): number {
  const parsed = Number(process.env.REALTIME_REDIS_STREAM_MAXLEN || 10000);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 10000;
  }
  return Math.floor(parsed);
}

function getBrokerState(): BrokerState {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[BROKER_STATE_KEY] as BrokerState | undefined;
  if (existing) {
    return existing;
  }

  const created: BrokerState = {
    listeners: new Set<RealtimeListener>(),
    subscriberReady: false,
    subscriberInitPromise: null,
    subscriber: null,
    publisher: null,
  };
  globalState[BROKER_STATE_KEY] = created;
  return created;
}

function getBrokerInstanceId(): string {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[BROKER_INSTANCE_ID_KEY] as string | undefined;
  if (existing) {
    return existing;
  }
  const created = randomUUID();
  globalState[BROKER_INSTANCE_ID_KEY] = created;
  return created;
}

function createRedisRuntimeClient() {
  const client = createClient({
    url: resolveRedisUrl(),
    socket: {
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 5000),
    },
    pingInterval: Number(process.env.REDIS_PING_INTERVAL_MS || 10000),
  });

  client.on('error', error => {
    console.error('[FastifyRealtimeBroker] redis client error:', error);
  });

  return client;
}

async function getBaseRedisClient() {
  const globalState = globalThis as unknown as Record<string, unknown>;
  let client = globalState[BASE_REDIS_CLIENT_KEY] as
    | ReturnType<typeof createClient>
    | undefined;
  if (!client) {
    client = createRedisRuntimeClient();
    globalState[BASE_REDIS_CLIENT_KEY] = client;
  }

  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

async function getPublisherClient() {
  const state = getBrokerState();
  if (state.publisher) {
    return state.publisher;
  }

  const base = await getBaseRedisClient();
  const publisher = base.duplicate();
  if (!publisher.isOpen) {
    await publisher.connect();
  }
  state.publisher = publisher;
  return publisher;
}

async function getSubscriberClient() {
  const state = getBrokerState();
  if (state.subscriber) {
    return state.subscriber;
  }

  const base = await getBaseRedisClient();
  const subscriber = base.duplicate();
  if (!subscriber.isOpen) {
    await subscriber.connect();
  }
  state.subscriber = subscriber;
  return subscriber;
}

async function recordPublishFailureMetric(error: unknown): Promise<void> {
  try {
    const publisher = await getPublisherClient();
    const nowIso = new Date().toISOString();
    const errorText =
      (error instanceof Error ? error.message : String(error)).slice(0, 300) ||
      'unknown publish failure';

    await publisher.sendCommand([
      'INCR',
      withRedisPrefix(METRIC_PUBLISH_FAILURE_TOTAL_KEY),
    ]);
    await publisher.sendCommand([
      'SET',
      withRedisPrefix(METRIC_PUBLISH_FAILURE_LAST_AT_KEY),
      nowIso,
    ]);
    await publisher.sendCommand([
      'SET',
      withRedisPrefix(METRIC_PUBLISH_FAILURE_LAST_ERROR_KEY),
      errorText,
    ]);
  } catch {
    // best-effort metrics only
  }
}

function dispatchToListeners(event: RealtimeEnvelope): void {
  const state = getBrokerState();
  for (const listener of state.listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error(
        '[FastifyRealtimeBroker] listener execution failed:',
        error
      );
    }
  }
}

async function ensureSubscriber(): Promise<void> {
  const state = getBrokerState();
  if (state.subscriberReady) {
    return;
  }
  if (state.subscriberInitPromise) {
    await state.subscriberInitPromise;
    return;
  }

  state.subscriberInitPromise = (async () => {
    const subscriber = await getSubscriberClient();
    await subscriber.subscribe(getChannelName(), raw => {
      try {
        const parsed = JSON.parse(raw) as RealtimeEnvelope;
        if (!parsed || typeof parsed !== 'object') {
          return;
        }
        if (typeof parsed.key !== 'string' || !parsed.payload) {
          return;
        }
        if (parsed.origin && parsed.origin === getBrokerInstanceId()) {
          return;
        }
        dispatchToListeners(parsed);
      } catch (error) {
        console.warn('[FastifyRealtimeBroker] invalid pubsub payload:', error);
      }
    });
    state.subscriberReady = true;
  })();

  try {
    await state.subscriberInitPromise;
  } finally {
    state.subscriberInitPromise = null;
  }
}

export async function publishRealtimeEvent(input: {
  key: string;
  payload: RealtimeDbChangePayload;
}): Promise<RealtimeEnvelope> {
  const localEventId = randomUUID();
  const origin = getBrokerInstanceId();
  const event: RealtimeEnvelope = {
    id: localEventId,
    key: input.key,
    emittedAt: Date.now(),
    origin,
    payload: input.payload,
  };

  try {
    const publisher = await getPublisherClient();
    const streamId = await publisher.xAdd(
      getStreamKey(),
      '*',
      {
        id: localEventId,
        origin,
        key: event.key,
        table: event.payload.table,
        schema: event.payload.schema,
        event_type: event.payload.eventType,
        commit_ts: event.payload.commitTimestamp,
        emitted_at: String(event.emittedAt),
        payload: JSON.stringify(event),
      },
      {
        TRIM: {
          strategy: 'MAXLEN',
          strategyModifier: '~',
          threshold: getStreamMaxLen(),
        },
      }
    );

    if (streamId) {
      event.id = String(streamId);
    }

    await publisher.publish(getChannelName(), JSON.stringify(event));
  } catch (error) {
    await recordPublishFailureMetric(error);
    if (allowLocalFallbackOnPublishFailure()) {
      console.warn(
        '[FastifyRealtimeBroker] publish failed, fallback to local dispatch:',
        error
      );
      dispatchToListeners(event);
      return event;
    }

    throw new Error(
      `[FastifyRealtimeBroker] publish failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  dispatchToListeners(event);
  return event;
}

function parseStreamEntries(raw: unknown): RealtimeEnvelope[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const events: RealtimeEnvelope[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) {
      continue;
    }

    const streamId = String(item[0] || '');
    const keyValues = item[1];
    if (!streamId || !Array.isArray(keyValues)) {
      continue;
    }

    let payloadRaw = '';
    for (let index = 0; index < keyValues.length - 1; index += 2) {
      const field = String(keyValues[index] || '');
      if (field !== 'payload') {
        continue;
      }
      payloadRaw = String(keyValues[index + 1] || '');
      break;
    }

    if (!payloadRaw) {
      continue;
    }

    try {
      const parsed = JSON.parse(payloadRaw) as RealtimeEnvelope;
      if (!parsed || typeof parsed !== 'object') {
        continue;
      }
      if (typeof parsed.key !== 'string' || !parsed.payload) {
        continue;
      }
      events.push({
        ...parsed,
        id: streamId,
      });
    } catch {
      // ignore malformed payload
    }
  }

  return events;
}

export async function readRealtimeEventsSince(input: {
  sinceId: string;
  key?: string;
  limit?: number;
}): Promise<RealtimeEnvelope[]> {
  const sinceId = (input.sinceId || '').trim();
  if (!sinceId) {
    return [];
  }

  const keyFilter = input.key?.trim() || '';
  const limit = Math.max(1, Math.min(2000, Number(input.limit || 300)));

  try {
    const publisher = await getPublisherClient();
    const rows = await publisher.sendCommand([
      'XRANGE',
      getStreamKey(),
      `(${sinceId}`,
      '+',
      'COUNT',
      String(limit),
    ]);

    const events = parseStreamEntries(rows);
    if (!keyFilter) {
      return events;
    }
    return events.filter(event => event.key === keyFilter);
  } catch (error) {
    console.warn(
      '[FastifyRealtimeBroker] failed to replay stream events:',
      error
    );
    return [];
  }
}

export async function subscribeRealtimeEvents(
  listener: RealtimeListener
): Promise<() => void> {
  const state = getBrokerState();
  state.listeners.add(listener);

  try {
    await ensureSubscriber();
  } catch (error) {
    console.warn(
      '[FastifyRealtimeBroker] subscribe failed, listener remains local-only:',
      error
    );
  }

  return () => {
    state.listeners.delete(listener);
  };
}

export async function getRealtimeBrokerStats(): Promise<{
  channel: string;
  streamKey: string;
  streamLength: number;
  localListenerCount: number;
  subscriberReady: boolean;
  pubSubSubscriberCount: number;
  publishFailureTotal: number;
  publishFailureLastAt: string | null;
  publishFailureLastError: string | null;
  outboxPendingCount: number;
}> {
  const state = getBrokerState();
  let streamLength = 0;
  let pubSubSubscriberCount = 0;
  let publishFailureTotal = 0;
  let publishFailureLastAt: string | null = null;
  let publishFailureLastError: string | null = null;
  let outboxPendingCount = 0;

  try {
    const publisher = await getPublisherClient();

    const rawLength = await publisher.sendCommand(['XLEN', getStreamKey()]);
    const parsedLength = Number(rawLength);
    if (Number.isFinite(parsedLength) && parsedLength >= 0) {
      streamLength = parsedLength;
    }

    const numSubRaw = await publisher.sendCommand([
      'PUBSUB',
      'NUMSUB',
      getChannelName(),
    ]);
    if (Array.isArray(numSubRaw) && numSubRaw.length >= 2) {
      const parsedNumSub = Number(numSubRaw[1]);
      if (Number.isFinite(parsedNumSub) && parsedNumSub >= 0) {
        pubSubSubscriberCount = parsedNumSub;
      }
    }

    const failureTotalRaw = await publisher.sendCommand([
      'GET',
      withRedisPrefix(METRIC_PUBLISH_FAILURE_TOTAL_KEY),
    ]);
    const failureTotal = Number(failureTotalRaw);
    if (Number.isFinite(failureTotal) && failureTotal >= 0) {
      publishFailureTotal = failureTotal;
    }

    const failureLastAtRaw = await publisher.sendCommand([
      'GET',
      withRedisPrefix(METRIC_PUBLISH_FAILURE_LAST_AT_KEY),
    ]);
    const failureLastAtText =
      failureLastAtRaw === null || failureLastAtRaw === undefined
        ? ''
        : String(failureLastAtRaw);
    publishFailureLastAt =
      failureLastAtText.trim().length > 0 ? failureLastAtText.trim() : null;

    const failureLastErrorRaw = await publisher.sendCommand([
      'GET',
      withRedisPrefix(METRIC_PUBLISH_FAILURE_LAST_ERROR_KEY),
    ]);
    const failureLastErrorText =
      failureLastErrorRaw === null || failureLastErrorRaw === undefined
        ? ''
        : String(failureLastErrorRaw);
    publishFailureLastError =
      failureLastErrorText.trim().length > 0
        ? failureLastErrorText.trim()
        : null;
  } catch {
    // best-effort metrics only
  }

  try {
    const pool = getPgPool();
    const { rows } = await pool.query<{ total: string | number }>(
      'SELECT COUNT(*)::bigint::text AS total FROM realtime_outbox_events'
    );
    const parsed = Number(rows[0]?.total || 0);
    if (Number.isFinite(parsed) && parsed >= 0) {
      outboxPendingCount = parsed;
    }
  } catch {
    // migration may not be present yet
  }

  return {
    channel: getChannelName(),
    streamKey: getStreamKey(),
    streamLength,
    localListenerCount: state.listeners.size,
    subscriberReady: state.subscriberReady,
    pubSubSubscriberCount,
    publishFailureTotal,
    publishFailureLastAt,
    publishFailureLastError,
    outboxPendingCount,
  };
}
