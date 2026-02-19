import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgUserContext } from '../lib/pg-context';
import {
  readRealtimeEventsSince,
  subscribeRealtimeEvents,
} from '../lib/realtime/broker';
import {
  type RealtimeEnvelope,
  type SubscriptionConfig,
  SubscriptionConfigs,
  SubscriptionKeys,
  matchesSubscriptionConfig,
} from '../lib/realtime/contract';
import { ensureRealtimeOutboxDispatcher } from '../lib/realtime/outbox-dispatcher';
import { registerRealtimeSubscription } from '../lib/realtime/subscription-registry';
import { buildRouteErrorPayload } from '../lib/route-error';
import {
  type ActorIdentity,
  resolveIdentityFromSession,
} from '../lib/session-identity';

interface InternalRealtimeStreamRoutesOptions {
  config: ApiRuntimeConfig;
}

type KeyScope =
  | { type: 'self-or-admin'; userId: string }
  | { type: 'admin-only' }
  | { type: 'conversation-owner-or-admin'; conversationId: string }
  | { type: 'authenticated' };

const KEEPALIVE_INTERVAL_MS = Number(
  process.env.REALTIME_SSE_KEEPALIVE_MS || 15000
);
const REPLAY_MAX_EVENTS = Math.max(
  1,
  Number(process.env.REALTIME_SSE_REPLAY_MAX_EVENTS || 500)
);
const SENT_EVENT_CACHE_SIZE = Math.max(
  100,
  Number(process.env.REALTIME_SSE_SENT_EVENT_CACHE_SIZE || 2048)
);

function readHeaderValue(value: string | string[] | undefined): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .join('; ')
      .trim();
  }
  return '';
}

async function requireActor(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<
  | { ok: true; actor: ActorIdentity }
  | { ok: false; statusCode: number; payload: Record<string, unknown> }
> {
  const resolved = await resolveIdentityFromSession(request, config);
  if (resolved.kind === 'unauthorized') {
    return {
      ok: false,
      statusCode: 401,
      payload: buildRouteErrorPayload({
        request,
        statusCode: 401,
        source: 'auth',
        code: 'AUTH_UNAUTHORIZED',
        userMessage: 'Unauthorized',
      }),
    };
  }
  if (resolved.kind === 'error') {
    return {
      ok: false,
      statusCode: 500,
      payload: buildRouteErrorPayload({
        request,
        statusCode: 500,
        source: 'auth',
        code: 'AUTH_VERIFY_FAILED',
        userMessage: 'Failed to verify session',
      }),
    };
  }
  return {
    ok: true,
    actor: resolved.identity,
  };
}

function getKeyScope(key: string): KeyScope | null {
  if (key === SubscriptionKeys.providers()) {
    return { type: 'authenticated' };
  }
  if (key === SubscriptionKeys.serviceInstances()) {
    return { type: 'authenticated' };
  }
  if (key === SubscriptionKeys.apiKeys()) {
    return { type: 'admin-only' };
  }

  const userScopedPrefixes = [
    'user-profile:',
    'sidebar-conversations:',
    'all-conversations:',
    'user-conversations:',
  ];
  for (const prefix of userScopedPrefixes) {
    if (key.startsWith(prefix)) {
      const userId = key.slice(prefix.length).trim();
      if (!userId) {
        return null;
      }
      return { type: 'self-or-admin', userId };
    }
  }

  const conversationPrefix = 'conversation-messages:';
  if (key.startsWith(conversationPrefix)) {
    const conversationId = key.slice(conversationPrefix.length).trim();
    if (!conversationId) {
      return null;
    }
    return { type: 'conversation-owner-or-admin', conversationId };
  }

  return null;
}

async function authorizeKeyScope(
  scope: KeyScope,
  identity: ActorIdentity
): Promise<boolean> {
  if (scope.type === 'authenticated') {
    return true;
  }
  if (scope.type === 'admin-only') {
    return identity.role === 'admin';
  }
  if (scope.type === 'self-or-admin') {
    return identity.role === 'admin' || identity.userId === scope.userId;
  }
  if (scope.type === 'conversation-owner-or-admin') {
    if (identity.role === 'admin') {
      return true;
    }

    const rows = await queryRowsWithPgUserContext<{ id: string }>(
      identity.userId,
      identity.role,
      `
        SELECT id::text
        FROM conversations
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [scope.conversationId]
    );
    return Boolean(rows[0]);
  }

  return false;
}

function parseEvent(eventRaw: string | undefined): SubscriptionConfig['event'] {
  if (
    eventRaw === 'INSERT' ||
    eventRaw === 'UPDATE' ||
    eventRaw === 'DELETE' ||
    eventRaw === '*'
  ) {
    return eventRaw;
  }
  return '*';
}

function defaultConfigByKey(key: string): SubscriptionConfig {
  if (key.startsWith('conversation-messages:')) {
    return SubscriptionConfigs.messages(
      key.replace(/^conversation-messages:/, '')
    );
  }
  if (key.startsWith('user-profile:')) {
    return SubscriptionConfigs.profiles(key.replace(/^user-profile:/, ''));
  }
  if (
    key.startsWith('sidebar-conversations:') ||
    key.startsWith('all-conversations:') ||
    key.startsWith('user-conversations:')
  ) {
    return SubscriptionConfigs.conversations(key.split(':')[1] || '');
  }
  if (key === SubscriptionKeys.providers()) {
    return SubscriptionConfigs.providers();
  }
  if (key === SubscriptionKeys.serviceInstances()) {
    return SubscriptionConfigs.serviceInstances();
  }
  return {
    event: '*',
    schema: 'public',
    table: '',
  };
}

function resolveConfigFromQuery(
  key: string,
  query: {
    schema?: string;
    table?: string;
    event?: string;
    filter?: string;
  }
): SubscriptionConfig {
  const fallback = defaultConfigByKey(key);
  const schema = (query.schema || '').trim() || fallback.schema;
  const table = (query.table || '').trim() || fallback.table;
  const event = parseEvent(query.event) || fallback.event;
  const filter = (query.filter || '').trim() || fallback.filter;

  return {
    schema,
    table,
    event,
    ...(filter ? { filter } : {}),
  };
}

function formatSseEvent(event: string, data: string, id?: string): string {
  if (id) {
    return `id: ${id}\nevent: ${event}\ndata: ${data}\n\n`;
  }
  return `event: ${event}\ndata: ${data}\n\n`;
}

export const internalRealtimeStreamRoutes: FastifyPluginAsync<
  InternalRealtimeStreamRoutesOptions
> = async (app, options) => {
  app.get<{
    Querystring: {
      key?: string;
      schema?: string;
      table?: string;
      event?: string;
      filter?: string;
      lastEventId?: string;
    };
  }>('/api/internal/realtime/stream', async (request, reply) => {
    const auth = await requireActor(request, options.config);
    if (!auth.ok) {
      return reply.status(auth.statusCode).send(auth.payload);
    }

    ensureRealtimeOutboxDispatcher();

    const key = (request.query.key || '').trim();
    if (!key) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'REALTIME_SUBSCRIPTION_KEY_MISSING',
          userMessage: 'Missing subscription key',
        })
      );
    }

    const scope = getKeyScope(key);
    if (!scope) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'REALTIME_SUBSCRIPTION_KEY_UNSUPPORTED',
          userMessage: 'Unsupported subscription key',
        })
      );
    }

    const allowed = await authorizeKeyScope(scope, auth.actor);
    if (!allowed) {
      return reply.status(403).send(
        buildRouteErrorPayload({
          request,
          statusCode: 403,
          source: 'auth',
          code: 'AUTH_FORBIDDEN',
          userMessage: 'Forbidden',
        })
      );
    }

    const config = resolveConfigFromQuery(key, request.query);
    if (!config.table) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'REALTIME_SUBSCRIPTION_TABLE_MISSING',
          userMessage: 'Missing table in subscription config',
        })
      );
    }

    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    if (typeof reply.raw.flushHeaders === 'function') {
      reply.raw.flushHeaders();
    }

    const sentEventIds: string[] = [];
    const sentEventIdSet = new Set<string>();
    const lastEventIdHeader = readHeaderValue(request.headers['last-event-id']);
    const lastEventIdParam = (request.query.lastEventId || '').trim();
    const lastEventId = lastEventIdHeader || lastEventIdParam;
    const unregisterSubscription = registerRealtimeSubscription(key, config);

    let closed = false;
    let unsubscribe: (() => void) | null = null;
    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

    const close = () => {
      if (closed) {
        return;
      }
      closed = true;

      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }

      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      unregisterSubscription();
      try {
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      } catch {
        // best-effort close
      }
    };

    const rememberEventId = (id: string) => {
      if (!id || sentEventIdSet.has(id)) {
        return;
      }
      sentEventIds.push(id);
      sentEventIdSet.add(id);
      if (sentEventIds.length > SENT_EVENT_CACHE_SIZE) {
        const removed = sentEventIds.shift();
        if (removed) {
          sentEventIdSet.delete(removed);
        }
      }
    };

    const send = (event: string, data: string, id?: string) => {
      if (closed) {
        return;
      }
      try {
        reply.raw.write(formatSseEvent(event, data, id));
      } catch {
        close();
      }
    };

    const sendEnvelope = (event: RealtimeEnvelope) => {
      const id = (event.id || '').trim();
      if (id && sentEventIdSet.has(id)) {
        return;
      }
      if (id) {
        rememberEventId(id);
      }
      send('message', JSON.stringify(event), id || undefined);
    };

    request.raw.on('close', close);
    request.raw.on('aborted', close);
    request.raw.on('error', close);

    send(
      'ready',
      JSON.stringify({
        key,
        schema: config.schema,
        table: config.table,
        event: config.event,
        ts: Date.now(),
      })
    );

    keepAliveTimer = setInterval(() => {
      send('ping', JSON.stringify({ ts: Date.now() }));
    }, KEEPALIVE_INTERVAL_MS);

    unsubscribe = await subscribeRealtimeEvents(event => {
      if (closed || event.key !== key) {
        return;
      }
      if (!matchesSubscriptionConfig(config, event.payload)) {
        return;
      }
      sendEnvelope(event);
    });

    if (lastEventId) {
      const replayEventsWithProbe = await readRealtimeEventsSince({
        sinceId: lastEventId,
        key,
        limit: REPLAY_MAX_EVENTS + 1,
      });
      const replayOverflow = replayEventsWithProbe.length > REPLAY_MAX_EVENTS;
      const replayEvents = replayOverflow
        ? replayEventsWithProbe.slice(0, REPLAY_MAX_EVENTS)
        : replayEventsWithProbe;

      if (replayOverflow) {
        send(
          'replay-gap',
          JSON.stringify({
            key,
            reason: 'replay_window_truncated',
            lastEventId,
            replayLimit: REPLAY_MAX_EVENTS,
            ts: Date.now(),
          })
        );
      }

      for (const replayEvent of replayEvents) {
        if (closed || replayEvent.key !== key) {
          continue;
        }
        if (!matchesSubscriptionConfig(config, replayEvent.payload)) {
          continue;
        }
        sendEnvelope(replayEvent);
      }
    }

    return reply;
  });
};
