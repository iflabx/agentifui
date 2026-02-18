import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';
import { queryRowsWithPgUserContext } from '@lib/server/pg/user-context';
import { ensureRealtimeOutboxDispatcher } from '@lib/server/realtime/outbox-dispatcher';
import {
  readRealtimeEventsSince,
  subscribeRealtimeEvents,
} from '@lib/server/realtime/redis-broker';
import {
  type RealtimeEnvelope,
  type SubscriptionConfig,
  SubscriptionConfigs,
  SubscriptionKeys,
  matchesSubscriptionConfig,
} from '@lib/services/db/realtime-service';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

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

type Identity = {
  userId: string;
  role: string | null;
};

type KeyScope =
  | { type: 'self-or-admin'; userId: string }
  | { type: 'admin-only' }
  | { type: 'conversation-owner-or-admin'; conversationId: string }
  | { type: 'authenticated' };

async function resolveIdentity(request: Request) {
  const result = await resolveSessionIdentity(request.headers);
  if (!result.success) {
    return {
      ok: false as const,
      response: nextApiErrorResponse({
        request,
        status: 500,
        source: 'auth',
        code: 'AUTH_VERIFY_FAILED',
        userMessage: 'Failed to verify session',
        developerMessage:
          result.error?.message ||
          'resolveSessionIdentity returned unsuccessful result',
      }),
    };
  }

  if (!result.data) {
    return {
      ok: false as const,
      response: nextApiErrorResponse({
        request,
        status: 401,
        source: 'auth',
        code: 'AUTH_UNAUTHORIZED',
        userMessage: 'Unauthorized',
      }),
    };
  }

  if (result.data.status !== 'active') {
    return {
      ok: false as const,
      response: nextApiErrorResponse({
        request,
        status: 403,
        source: 'auth',
        code: 'AUTH_ACCOUNT_INACTIVE',
        userMessage: 'Account is not active',
      }),
    };
  }

  return { ok: true as const, identity: result.data };
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
  identity: Identity
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

function parseEvent(eventRaw: string | null): SubscriptionConfig['event'] {
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
    const conversationId = key.replace(/^conversation-messages:/, '');
    return SubscriptionConfigs.messages(conversationId);
  }

  if (key.startsWith('user-profile:')) {
    const userId = key.replace(/^user-profile:/, '');
    return SubscriptionConfigs.profiles(userId);
  }

  if (
    key.startsWith('sidebar-conversations:') ||
    key.startsWith('all-conversations:') ||
    key.startsWith('user-conversations:')
  ) {
    const userId = key.split(':')[1] || '';
    return SubscriptionConfigs.conversations(userId);
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

function resolveConfigFromSearchParams(
  key: string,
  searchParams: URLSearchParams
): SubscriptionConfig {
  const fallback = defaultConfigByKey(key);

  const schema = (searchParams.get('schema') || '').trim() || fallback.schema;
  const table = (searchParams.get('table') || '').trim() || fallback.table;
  const event = parseEvent(searchParams.get('event')) || fallback.event;
  const filter = (searchParams.get('filter') || '').trim() || fallback.filter;

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

export async function GET(request: Request) {
  try {
    const auth = await resolveIdentity(request);
    if (!auth.ok) {
      return auth.response;
    }

    // Ensure DB outbox dispatcher is running before binding SSE stream.
    ensureRealtimeOutboxDispatcher();

    const url = new URL(request.url);
    const key = (url.searchParams.get('key') || '').trim();
    if (!key) {
      return nextApiErrorResponse({
        request,
        status: 400,
        code: 'REALTIME_SUBSCRIPTION_KEY_MISSING',
        userMessage: 'Missing subscription key',
      });
    }

    const scope = getKeyScope(key);
    if (!scope) {
      return nextApiErrorResponse({
        request,
        status: 400,
        code: 'REALTIME_SUBSCRIPTION_KEY_UNSUPPORTED',
        userMessage: 'Unsupported subscription key',
      });
    }

    const allowed = await authorizeKeyScope(scope, auth.identity);
    if (!allowed) {
      return nextApiErrorResponse({
        request,
        status: 403,
        source: 'auth',
        code: 'AUTH_FORBIDDEN',
        userMessage: 'Forbidden',
      });
    }

    const config = resolveConfigFromSearchParams(key, url.searchParams);
    if (!config.table) {
      return nextApiErrorResponse({
        request,
        status: 400,
        code: 'REALTIME_SUBSCRIPTION_TABLE_MISSING',
        userMessage: 'Missing table in subscription config',
      });
    }

    const encoder = new TextEncoder();
    const sentEventIds: string[] = [];
    const sentEventIdSet = new Set<string>();
    const lastEventIdHeader = (
      request.headers.get('last-event-id') || ''
    ).trim();
    const lastEventIdParam = (url.searchParams.get('lastEventId') || '').trim();
    const lastEventId = lastEventIdHeader || lastEventIdParam;
    let unsubscribe: (() => void) | null = null;
    let closed = false;
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
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
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
            controller.enqueue(encoder.encode(formatSseEvent(event, data, id)));
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

        request.signal.addEventListener('abort', () => {
          close();
          try {
            controller.close();
          } catch {
            // ignore
          }
        });

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
          const replayOverflow =
            replayEventsWithProbe.length > REPLAY_MAX_EVENTS;
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
      },
      cancel() {
        close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('[InternalRealtimeStreamAPI] GET failed:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      code: 'INTERNAL_REALTIME_STREAM_FAILED',
      userMessage: 'Failed to establish realtime stream',
      developerMessage:
        error instanceof Error
          ? error.message
          : 'Unknown realtime stream initialization error',
    });
  }
}
