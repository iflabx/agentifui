import { redisManager } from '@lib/infra/redis';
import type {
  RealtimeDbChangePayload,
  RealtimeEnvelope,
} from '@lib/services/db/realtime-service';
import crypto from 'node:crypto';

type RealtimeListener = (event: RealtimeEnvelope) => void;

const BROKER_STATE_KEY = '__agentifui_realtime_redis_broker__';
const BROKER_INSTANCE_ID_KEY =
  '__agentifui_realtime_redis_broker_instance_id__';
const DEFAULT_CHANNEL = 'realtime:events';
const DEFAULT_STREAM_KEY = 'realtime:events:stream';

type BrokerState = {
  listeners: Set<RealtimeListener>;
  subscriberReady: boolean;
  subscriberInitPromise: Promise<void> | null;
  subscriber: ReturnType<typeof redisManager.getClient> extends Promise<infer T>
    ? T | null
    : null;
  publisher: ReturnType<typeof redisManager.getClient> extends Promise<infer T>
    ? T | null
    : null;
};

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

  const created = crypto.randomUUID();
  globalState[BROKER_INSTANCE_ID_KEY] = created;
  return created;
}

async function getPublisherClient() {
  const state = getBrokerState();
  if (state.publisher) {
    return state.publisher;
  }

  const base = await redisManager.getClient();
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

  const base = await redisManager.getClient();
  const subscriber = base.duplicate();
  if (!subscriber.isOpen) {
    await subscriber.connect();
  }
  state.subscriber = subscriber;
  return subscriber;
}

function dispatchToListeners(event: RealtimeEnvelope) {
  const state = getBrokerState();
  for (const listener of state.listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('[RealtimeRedisBroker] listener execution failed:', error);
    }
  }
}

async function ensureSubscriber() {
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
          // Local publish already dispatched to listeners; skip loopback duplicate.
          return;
        }
        dispatchToListeners(parsed);
      } catch (error) {
        console.warn('[RealtimeRedisBroker] invalid pubsub payload:', error);
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
  const localEventId = crypto.randomUUID();
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
    // Keep a bounded stream as a replay/diagnostic window.
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
    console.warn(
      '[RealtimeRedisBroker] publish failed, fallback to local dispatch:',
      error
    );
  }

  // Always deliver locally for low-latency same-process dispatch.
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
    for (let i = 0; i < keyValues.length - 1; i += 2) {
      const field = String(keyValues[i] || '');
      if (field !== 'payload') {
        continue;
      }
      payloadRaw = String(keyValues[i + 1] || '');
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
      // Ignore malformed payload and continue scanning.
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
      '[RealtimeRedisBroker] failed to replay stream events:',
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
      '[RealtimeRedisBroker] subscribe failed, listener remains local-only:',
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
}> {
  const state = getBrokerState();
  let streamLength = 0;

  try {
    const publisher = await getPublisherClient();
    const raw = await publisher.sendCommand(['XLEN', getStreamKey()]);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      streamLength = parsed;
    }
  } catch {
    // best-effort metrics only
  }

  return {
    channel: getChannelName(),
    streamKey: getStreamKey(),
    streamLength,
    localListenerCount: state.listeners.size,
    subscriberReady: state.subscriberReady,
  };
}
