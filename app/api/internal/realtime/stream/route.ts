import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { queryRowsWithPgUserContext } from '@lib/server/pg/user-context';
import { subscribeRealtimeEvents } from '@lib/server/realtime/redis-broker';
import {
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
      response: NextResponse.json(
        { success: false, error: 'Failed to verify session' },
        { status: 500 }
      ),
    };
  }

  if (!result.data) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      ),
    };
  }

  if (result.data.status !== 'active') {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Account is not active' },
        { status: 403 }
      ),
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

function formatSseEvent(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

export async function GET(request: Request) {
  try {
    const auth = await resolveIdentity(request);
    if (!auth.ok) {
      return auth.response;
    }

    const url = new URL(request.url);
    const key = (url.searchParams.get('key') || '').trim();
    if (!key) {
      return NextResponse.json(
        { success: false, error: 'Missing subscription key' },
        { status: 400 }
      );
    }

    const scope = getKeyScope(key);
    if (!scope) {
      return NextResponse.json(
        { success: false, error: 'Unsupported subscription key' },
        { status: 400 }
      );
    }

    const allowed = await authorizeKeyScope(scope, auth.identity);
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const config = resolveConfigFromSearchParams(key, url.searchParams);
    if (!config.table) {
      return NextResponse.json(
        { success: false, error: 'Missing table in subscription config' },
        { status: 400 }
      );
    }

    const encoder = new TextEncoder();
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
        const send = (event: string, data: string) => {
          if (closed) {
            return;
          }

          try {
            controller.enqueue(encoder.encode(formatSseEvent(event, data)));
          } catch {
            close();
          }
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

          send('message', JSON.stringify(event));
        });
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
    return NextResponse.json(
      { success: false, error: 'Failed to establish realtime stream' },
      { status: 500 }
    );
  }
}
