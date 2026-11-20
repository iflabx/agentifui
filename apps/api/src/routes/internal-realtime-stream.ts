import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import {
  projectAuthorizedRealtimeEvent,
  realtimeConversationAccessSql,
} from '../lib/realtime/access';
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
  | { type: 'conversation-owner'; conversationId: string }
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
  const resolved = await resolveIdentityFromSession(request, config, {
    bypassCache: true,
  });
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
    return { type: 'admin-only' };
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
    return { type: 'conversation-owner', conversationId };
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
  if (scope.type === 'conversation-owner') {
    const rows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        SELECT conversations.id::text
        FROM conversations
        WHERE conversations.id = $1::uuid
          AND conversations.status = 'active'
          AND conversations.user_id = $2::uuid
          AND ${realtimeConversationAccessSql()}
        LIMIT 1
      `,
      [scope.conversationId, identity.userId],
      { statementTimeoutMs: 5000 }
    );
    return Boolean(rows[0]);
  }

  return false;
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
  if (key === SubscriptionKeys.apiKeys()) {
    return SubscriptionConfigs.apiKeys();
  }
  return {
    event: '*',
    schema: 'public',
    table: '',
  };
}

function resolveConfigFromKey(key: string): SubscriptionConfig {
  return defaultConfigByKey(key);
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

    const config = resolveConfigFromKey(key);
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
    let pendingEvents = 0;
    let finishReplay: () => void = () => {};
    let eventQueue = new Promise<void>(resolve => {
      finishReplay = resolve;
    });

    const close = () => {
      if (closed) {
        return;
      }
      closed = true;
      request.raw.removeListener('close', close);
      request.raw.removeListener('aborted', close);
      request.raw.removeListener('error', close);
      reply.raw.removeListener('close', close);

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
        if (!reply.raw.write(formatSseEvent(event, data, id))) close();
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
    reply.raw.on('close', close);

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

    if (closed) return reply;

    keepAliveTimer = setInterval(() => {
      send('ping', JSON.stringify({ ts: Date.now() }));
    }, KEEPALIVE_INTERVAL_MS);

    try {
      const release = await subscribeRealtimeEvents(event => {
        if (closed || event.key !== key) {
          return;
        }
        if (!matchesSubscriptionConfig(config, event.payload)) {
          return;
        }
        if (++pendingEvents > 256) {
          close();
          return;
        }
        eventQueue = eventQueue
          .then(async () => {
            if (closed) return;
            const safe = await projectAuthorizedRealtimeEvent(
              event,
              auth.actor
            );
            if (safe && !closed) sendEnvelope(safe);
          })
          .catch(() => close())
          .finally(() => {
            pendingEvents -= 1;
          });
      });
      if (closed) {
        release();
        return reply;
      }
      unsubscribe = release;

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
          const safe = await projectAuthorizedRealtimeEvent(
            replayEvent,
            auth.actor
          );
          if (safe && !closed) sendEnvelope(safe);
        }
      }
    } catch (error) {
      request.log.warn(
        { err: error },
        '[FastifyRealtimeStream] subscription failed'
      );
      close();
    } finally {
      finishReplay();
    }

    return reply;
  });
};
