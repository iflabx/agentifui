/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';

import type { ApiRuntimeConfig } from '../../apps/api/src/config';
import { getPgPool } from '../../apps/api/src/lib/pg-context';
import { createApiServer } from '../../apps/api/src/server';
import { resolveTestDatabaseUrl } from './helpers/test-database-url';

jest.mock('../../apps/api/src/lib/error-events', () => ({
  recordApiErrorEvent: jest.fn().mockResolvedValue(undefined),
}));

const config: ApiRuntimeConfig = {
  host: '127.0.0.1',
  port: 3010,
  logLevel: 'silent',
  corsAllowedOrigins: [],
  nextUpstreamBaseUrl: 'http://127.0.0.1:3000',
  proxyPrefixes: [],
  realtimeSourceMode: 'db-outbox',
  sessionCookieNames: ['session_token'],
  internalDataProxyTimeoutMs: 30000,
  difyTempConfigEnabled: false,
  difyTempConfigAllowedHosts: [],
  difyTempConfigAllowPrivate: false,
  inputModeration: { enabled: false, app: null },
};

const actors = [randomUUID(), randomUUID(), randomUUID()];
const tokens = actors.map(() => randomUUID());
const providerId = randomUUID();
const applicationId = randomUUID();
const groupId = randomUUID();
const appName = `access-${randomUUID()}`;
const roleName = `access_${randomUUID().replaceAll('-', '')}`;
const originalEnvironment = { ...process.env };
const originalFetch = global.fetch;
const upstreamRequests: Array<{ path: string; body: Record<string, unknown> }> =
  [];
let app: Awaited<ReturnType<typeof createApiServer>>;
let database: Pool;
let upstream: ReturnType<typeof createHttpServer>;
let signalPendingStream: (() => void) | undefined;
let finishPendingStream: (() => void) | undefined;

async function action(
  actor: number,
  name: string,
  payload: Record<string, unknown>
) {
  return app.inject({
    method: 'POST',
    url: '/api/internal/data',
    headers: { cookie: `session_token=${tokens[actor]}` },
    payload: { action: name, payload },
  });
}

async function proxy(
  actor: number,
  path = 'chat-messages',
  method: 'GET' | 'POST' = 'POST',
  body: Record<string, unknown> = {}
) {
  return app.inject({
    method,
    url: `/api/dify/${appName}/${path}`,
    headers: { cookie: `session_token=${tokens[actor]}` },
    ...(method === 'POST'
      ? { payload: { query: 'synthetic question', ...body } }
      : {}),
  });
}

async function expireIdentityCache() {
  await new Promise(resolve => setTimeout(resolve, 1050));
}

beforeAll(async () => {
  global.fetch = jest.requireActual<{ fetch: typeof fetch }>(
    'next/dist/compiled/@edge-runtime/primitives/fetch'
  ).fetch;
  const databaseUrl = resolveTestDatabaseUrl();
  database = new Pool({ connectionString: databaseUrl });
  upstream = createHttpServer((request, response) => {
    let raw = '';
    request.on('data', chunk => {
      raw += chunk.toString();
    });
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      upstreamRequests.push({ path: request.url || '', body });
      if (body.query === 'synthetic ongoing run') {
        response.setHeader('Content-Type', 'text/event-stream');
        response.write(
          'data: {"event":"message","answer":"synthetic partial"}\n\n'
        );
        finishPendingStream = () => {
          if (!response.writableEnded)
            response.end('data: {"event":"message_end"}\n\n');
        };
        signalPendingStream?.();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          answer: 'synthetic response',
          user: body.user,
          id: 'synthetic-resource',
        })
      );
    });
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address() as AddressInfo;
  await database.query(
    `CREATE ROLE ${roleName} NOLOGIN NOSUPERUSER NOBYPASSRLS`
  );
  await database.query(`GRANT USAGE ON SCHEMA public TO ${roleName}`);
  await database.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${roleName}`
  );
  await database.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${roleName}`
  );
  for (const [index, id] of actors.entries()) {
    await database.query(
      'INSERT INTO auth_users (id, name, email) VALUES ($1, $2, $3)',
      [id, 'Synthetic User', `${id}@example.invalid`]
    );
    await database.query(
      'INSERT INTO profiles (id, email, role, status) VALUES ($1, $2, $3, $4)',
      [id, `${id}@example.invalid`, index === 2 ? 'admin' : 'user', 'active']
    );
    await database.query(
      "INSERT INTO auth_sessions (user_id, token, expires_at) VALUES ($1, $2, NOW() + interval '1 hour')",
      [id, tokens[index]]
    );
  }
  await database.query(
    "INSERT INTO providers (id, name, type, base_url, auth_type) VALUES ($1, $2, 'dify', $3, 'bearer')",
    [providerId, appName, `http://127.0.0.1:${address.port}/v1`]
  );
  await database.query(
    "INSERT INTO service_instances (id, provider_id, instance_id, visibility, config) VALUES ($1, $2, $3, 'group_only', $4)",
    [
      applicationId,
      providerId,
      appName,
      { app_metadata: { dify_apptype: 'chatbot' } },
    ]
  );
  await database.query(
    "INSERT INTO api_keys (provider_id, service_instance_id, key_value, is_default) VALUES ($1, $2, 'synthetic-upstream-key', TRUE)",
    [providerId, applicationId]
  );
  await database.query('INSERT INTO groups (id, name) VALUES ($1, $2)', [
    groupId,
    appName,
  ]);
  await database.query(
    'INSERT INTO group_app_permissions (group_id, service_instance_id) VALUES ($1, $2)',
    [groupId, applicationId]
  );
  for (const id of actors)
    await database.query(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)',
      [groupId, id]
    );
  const scopedUrl = new URL(databaseUrl);
  scopedUrl.searchParams.set('options', `-c role=${roleName}`);
  process.env.DATABASE_URL = scopedUrl.toString();
  process.env.APP_RLS_STRICT_MODE = 'true';
  process.env.FASTIFY_SESSION_IDENTITY_CACHE_TTL_MS = '1000';
  delete (globalThis as Record<string, unknown>)
    .__agentifui_fastify_session_resolver_cache__;
  app = await createApiServer(config);
  await app.ready();
}, 30000);

beforeEach(() => {
  upstreamRequests.length = 0;
});

afterAll(async () => {
  finishPendingStream?.();
  global.fetch = originalFetch;
  if (app) await app.close();
  if (upstream)
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  const state = globalThis as Record<string, unknown>;
  if (state.__agentifui_fastify_pg_pool__) await getPgPool().end();
  delete state.__agentifui_fastify_pg_pool__;
  delete state.__agentifui_fastify_session_resolver_cache__;
  if (database) {
    await database.query('DELETE FROM groups WHERE id = $1', [groupId]);
    await database.query('DELETE FROM providers WHERE id = $1', [providerId]);
    await database.query('DELETE FROM profiles WHERE id = ANY($1::uuid[])', [
      actors,
    ]);
    await database.query('DELETE FROM auth_users WHERE id = ANY($1::uuid[])', [
      actors,
    ]);
    await database.query(`DROP OWNED BY ${roleName}`);
    await database.query(`DROP ROLE ${roleName}`);
    await database.end();
  }
  for (const key of [
    'DATABASE_URL',
    'APP_RLS_STRICT_MODE',
    'FASTIFY_SESSION_IDENTITY_CACHE_TTL_MS',
  ]) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});

it('uses a non-superuser connection so application RLS is actually exercised', async () => {
  const result = await getPgPool().query(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
  );
  expect(result.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
});

it('keeps two authorized users bound to their own upstream identity', async () => {
  for (const actor of [0, 1]) {
    const result = await proxy(
      actor,
      'chat-messages?user=forged&user=duplicate',
      'POST',
      { user: actors[1 - actor], inputs: { agentifui_user_id: 'forged' } }
    );
    expect(result.statusCode).toBe(200);
    expect(result.json().user).toBe(actors[actor]);
    const seen = upstreamRequests.at(-1)!;
    expect(seen.body.user).toBe(actors[actor]);
    expect(seen.body.inputs).toMatchObject({
      agentifui_user_id: actors[actor],
    });
    expect(
      new URL(seen.path, 'http://example.invalid').searchParams.getAll('user')
    ).toEqual([actors[actor]]);
  }
});

it('rejects client-selected identities and protects local conversations and messages', async () => {
  const created = await action(0, 'conversations.createConversation', {
    conversation: { title: 'Synthetic conversation', app_id: appName },
  });
  expect(created.statusCode).toBe(200);
  const conversation = created.json().data;
  expect(conversation.user_id).toBe(actors[0]);
  expect(
    (
      await action(0, 'messages.save', {
        message: {
          conversation_id: conversation.id,
          role: 'user',
          content: 'synthetic first message',
        },
      })
    ).statusCode
  ).toBe(200);
  expect(
    (await action(1, 'messages.getLatest', { conversationId: conversation.id }))
      .statusCode
  ).toBe(404);
  expect(
    (
      await action(1, 'messages.save', {
        message: {
          conversation_id: conversation.id,
          role: 'user',
          content: 'forbidden',
        },
      })
    ).statusCode
  ).toBe(404);
  expect(
    (
      await action(1, 'conversations.renameConversation', {
        conversationId: conversation.id,
        title: 'forbidden',
      })
    ).json().data
  ).toBe(false);
  expect(
    (
      await action(1, 'conversations.deleteConversation', {
        conversationId: conversation.id,
      })
    ).json().data
  ).toBe(false);
  expect(
    (
      await action(1, 'conversations.getUserConversations', {
        userId: actors[0],
      })
    ).statusCode
  ).toBe(403);
  const ownConversation = await action(1, 'conversations.createConversation', {
    conversation: { title: 'Second synthetic conversation', app_id: appName },
  });
  expect(ownConversation.statusCode).toBe(200);
  expect(ownConversation.json().data.user_id).toBe(actors[1]);
  expect(
    (
      await action(0, 'messages.getLatest', {
        conversationId: ownConversation.json().data.id,
      })
    ).statusCode
  ).toBe(404);
  const history = await action(0, 'messages.getLatest', {
    conversationId: conversation.id,
  });
  expect(history.json().data).toHaveLength(1);
  expect(history.json().data[0].content).toBe('synthetic first message');
  expect(
    (
      await action(0, 'conversations.deleteConversation', {
        conversationId: conversation.id,
      })
    ).json().data
  ).toBe(true);
  expect(
    (
      await action(1, 'conversations.deleteConversation', {
        conversationId: ownConversation.json().data.id,
      })
    ).json().data
  ).toBe(true);
});

it('does not accept client-saved execution identifiers as upstream ownership proof', async () => {
  const created = await action(0, 'appExecutions.create', {
    execution: {
      service_instance_id: applicationId,
      execution_type: 'workflow',
      title: 'Synthetic execution',
      external_execution_id: 'synthetic-other-run',
      task_id: 'synthetic-other-task',
    },
  });
  expect(created.statusCode).toBe(200);
  const executionId = created.json().data.id;
  expect(
    (await action(1, 'appExecutions.getById', { executionId })).json().data
  ).toBeNull();
  expect(
    (await proxy(0, 'workflows/run/synthetic-other-run', 'GET')).statusCode
  ).toBe(403);
  expect(
    (await proxy(0, 'workflows/tasks/synthetic-other-task/stop')).statusCode
  ).toBe(403);
  expect(upstreamRequests).toHaveLength(0);
});

it.each([
  ['GET', 'workflows/logs'],
  ['GET', 'workflows/run/synthetic-run'],
  ['POST', 'workflows/tasks/synthetic-task/stop'],
  ['GET', 'files/synthetic-file/preview'],
] as const)(
  'denies unproven app-scoped %s %s before any upstream request',
  async (method, path) => {
    for (const actor of [0, 1])
      expect((await proxy(actor, path, method)).statusCode).toBe(403);
    expect(upstreamRequests).toHaveLength(0);
    expect((await proxy(2, path, method)).statusCode).toBe(200);
    expect(upstreamRequests).toHaveLength(1);
  }
);

it('rejects temporary upstream configuration from a normal user', async () => {
  const response = await proxy(0, 'chat-messages', 'POST', {
    _temp_config: {
      apiUrl: 'http://example.invalid/v1',
      apiKey: 'synthetic-key',
    },
  });
  expect(response.statusCode).toBe(403);
  expect(upstreamRequests).toHaveLength(0);
});

it('denies application access after group authorization is removed even when a public default exists', async () => {
  const defaultId = randomUUID();
  await database.query(
    "INSERT INTO service_instances (id, provider_id, instance_id, visibility, is_default) VALUES ($1, $2, $3, 'public', TRUE)",
    [defaultId, providerId, `${appName}-default`]
  );
  await database.query(
    "INSERT INTO api_keys (provider_id, service_instance_id, key_value, is_default) VALUES ($1, $2, 'synthetic-default-key', TRUE)",
    [providerId, defaultId]
  );
  expect((await proxy(1)).statusCode).toBe(200);
  await database.query(
    'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, actors[1]]
  );
  try {
    upstreamRequests.length = 0;
    expect((await proxy(1)).statusCode).toBe(400);
    expect(upstreamRequests).toHaveLength(0);
  } finally {
    await database.query(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)',
      [groupId, actors[1]]
    );
    await database.query('DELETE FROM service_instances WHERE id = $1', [
      defaultId,
    ]);
  }
});

it('rejects suspended accounts after the documented identity cache expires', async () => {
  expect((await proxy(1)).statusCode).toBe(200);
  await database.query(
    "UPDATE profiles SET status = 'suspended' WHERE id = $1",
    [actors[1]]
  );
  try {
    await expireIdentityCache();
    expect((await proxy(1)).statusCode).toBe(401);
    expect(upstreamRequests).toHaveLength(1);
  } finally {
    await database.query(
      "UPDATE profiles SET status = 'active' WHERE id = $1",
      [actors[1]]
    );
  }
});

it('does not revive a revoked session when an account is enabled again', async () => {
  expect((await proxy(1)).statusCode).toBe(200);
  await database.query('DELETE FROM auth_sessions WHERE token = $1', [
    tokens[1],
  ]);
  await database.query(
    "UPDATE profiles SET status = 'suspended' WHERE id = $1",
    [actors[1]]
  );
  await database.query("UPDATE profiles SET status = 'active' WHERE id = $1", [
    actors[1],
  ]);
  try {
    await expireIdentityCache();
    expect((await proxy(1)).statusCode).toBe(401);
    expect(upstreamRequests).toHaveLength(1);
  } finally {
    await database.query(
      "INSERT INTO auth_sessions (user_id, token, expires_at) VALUES ($1, $2, NOW() + interval '1 hour')",
      [actors[1], tokens[1]]
    );
  }
});

it('denies old administrative privileges after demotion and cache expiry', async () => {
  const request = () =>
    app.inject({
      method: 'GET',
      url: '/api/admin/status',
      headers: { cookie: `session_token=${tokens[2]}` },
    });
  expect((await request()).statusCode).toBe(200);
  await database.query("UPDATE profiles SET role = 'user' WHERE id = $1", [
    actors[2],
  ]);
  try {
    await expireIdentityCache();
    expect((await request()).statusCode).toBe(403);
    expect((await proxy(2)).statusCode).toBe(200);
  } finally {
    await database.query("UPDATE profiles SET role = 'admin' WHERE id = $1", [
      actors[2],
    ]);
  }
});

it('rejects new requests after revocation without claiming to cancel an existing stream', async () => {
  const started = new Promise<void>(resolve => {
    signalPendingStream = resolve;
  });
  const active = proxy(1, 'chat-messages', 'POST', {
    query: 'synthetic ongoing run',
    response_mode: 'streaming',
  });
  try {
    await started;
    await database.query('DELETE FROM auth_sessions WHERE token = $1', [
      tokens[1],
    ]);
    await expireIdentityCache();
    expect((await proxy(1)).statusCode).toBe(401);
    expect(upstreamRequests).toHaveLength(1);
    finishPendingStream?.();
    const result = await active;
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('message_end');
  } finally {
    finishPendingStream?.();
    await active;
    signalPendingStream = undefined;
    finishPendingStream = undefined;
    await database.query(
      "INSERT INTO auth_sessions (user_id, token, expires_at) VALUES ($1, $2, NOW() + interval '1 hour') ON CONFLICT (token) DO NOTHING",
      [actors[1], tokens[1]]
    );
  }
});
