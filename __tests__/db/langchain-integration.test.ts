/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';

import type { ApiRuntimeConfig } from '../../apps/api/src/config';
import { getPgPool } from '../../apps/api/src/lib/pg-context';
import { createApiServer } from '../../apps/api/src/server';
import { resolveTestDatabaseUrl } from './helpers/test-database-url';

jest.mock('../../apps/api/src/lib/error-events', () => ({
  recordApiErrorEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.setTimeout(30000);

const originalEnvironment = { ...process.env };
const originalFetch = global.fetch;
const actors = Array.from({ length: 4 }, () => randomUUID());
const tokens = actors.map(() => randomUUID());
const providerId = randomUUID();
const applications = Array.from({ length: 3 }, () => randomUUID());
const groupId = randomUUID();
const marker = `langchain-${randomUUID()}`;
const roleName = `langchain_${randomUUID().replaceAll('-', '')}`;
const triggerName = `${roleName}_save`;
const serviceKey = 'synthetic-agent-service-key';
const privateMarker = 'synthetic-upstream-private-details';
const capacityToken = 'synthetic-capacity-token-for-isolated-test';
const servers: Awaited<ReturnType<typeof createApiServer>>[] = [];
const upstreamRequests: Array<{ path: string; body: Record<string, unknown> }> =
  [];
const threads = new Map<
  string,
  { turns: string[]; runs: Map<string, string> }
>();
const pending = new Map<string, () => void>();
let database: Pool;
let upstream: ReturnType<typeof createServer>;

const config: ApiRuntimeConfig = {
  host: '127.0.0.1',
  port: 0,
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

interface ClientEvent {
  type: string;
  runId?: string;
  conversationId?: string;
  messageId?: string;
  executionStatus?: string;
  persistenceStatus?: string;
  errorCode?: string;
  [key: string]: unknown;
}

function events(body: string): ClientEvent[] {
  return body
    .split(/\r?\n/)
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)) as ClientEvent);
}

async function waitFor<T>(
  operation: () => Promise<T> | T,
  accept: (result: T) => boolean
): Promise<T> {
  const deadline = Date.now() + 10000;
  while (true) {
    const result = await operation();
    if (accept(result)) return result;
    if (Date.now() >= deadline)
      throw new Error('Timed out waiting for isolated test condition');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function request(actor: number, path: string, server = 0) {
  return servers[server].inject({
    method: 'GET',
    url: path,
    headers: { cookie: `session_token=${tokens[actor]}` },
  });
}

async function submit(
  actor: number,
  content = 'normal',
  options: {
    server?: number;
    app?: number;
    submissionId?: string;
    conversationId?: string;
    extra?: Record<string, unknown>;
  } = {}
) {
  return servers[options.server ?? 0].inject({
    method: 'POST',
    url: `/api/internal/apps/${applications[options.app ?? 0]}/agent/runs`,
    headers: { cookie: `session_token=${tokens[actor]}` },
    payload: {
      submissionId: options.submissionId ?? randomUUID(),
      content,
      ...(options.conversationId
        ? { conversationId: options.conversationId }
        : {}),
      ...options.extra,
    },
  });
}

async function action(
  actor: number,
  name: string,
  payload: Record<string, unknown>
) {
  return servers[0].inject({
    method: 'POST',
    url: '/api/internal/data',
    headers: { cookie: `session_token=${tokens[actor]}` },
    payload: { action: name, payload },
  });
}

function modelCalls() {
  return upstreamRequests.filter(item => item.path === '/ag-ui');
}

function accepted(body: string) {
  const event = events(body).find(item => item.type === 'accepted');
  expect(event).toMatchObject({
    runId: expect.any(String),
    conversationId: expect.any(String),
  });
  return event as ClientEvent & { runId: string; conversationId: string };
}

async function getStoredRun(runId: string) {
  return (
    await database.query('SELECT * FROM backend_runs WHERE id = $1', [runId])
  ).rows[0];
}

async function finishPending() {
  for (const finish of pending.values()) finish();
  pending.clear();
  await waitFor(
    async () =>
      (
        await database.query(
          `SELECT count(*)::int AS count FROM backend_runs WHERE user_id = ANY($1::uuid[])
       AND execution_status IN ('reserved','submitting','running')`,
          [actors]
        )
      ).rows[0].count as number,
    count => count === 0
  );
}

beforeAll(async () => {
  global.fetch = jest.requireActual<{ fetch: typeof fetch }>(
    'next/dist/compiled/@edge-runtime/primitives/fetch'
  ).fetch;
  const databaseUrl = resolveTestDatabaseUrl();
  database = new Pool({ connectionString: databaseUrl });
  upstream = createServer((incoming, response) => {
    let raw = '';
    incoming.on('data', chunk => {
      raw += chunk.toString();
    });
    incoming.on('end', () => {
      const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
      const path = incoming.url || '';
      upstreamRequests.push({ path, body });
      response.setHeader('content-type', 'application/json');
      if (
        ![serviceKey, `${serviceKey}-rotated`].some(
          key => incoming.headers.authorization === `Bearer ${key}`
        )
      ) {
        response.writeHead(401);
        response.end('{}');
        return;
      }
      if (path === '/threads' && incoming.method === 'POST') {
        const threadId = randomUUID();
        threads.set(threadId, { turns: [], runs: new Map() });
        response.end(JSON.stringify({ thread_id: threadId }));
        return;
      }
      if (path === '/capabilities') {
        response.end(JSON.stringify({ assistant_id: 'agent' }));
        return;
      }
      const statusPath = /^\/threads\/([^/]+)\/runs\/([^/]+)$/.exec(path);
      if (statusPath) {
        const [, threadId, runId] = statusPath;
        const status = threads.get(threadId)?.runs.get(runId);
        response.writeHead(status ? 200 : 404);
        response.end(
          JSON.stringify({ thread_id: threadId, run_id: runId, status })
        );
        return;
      }
      if (path !== '/ag-ui') {
        response.writeHead(404);
        response.end('{}');
        return;
      }
      const threadId = String(body.threadId);
      const runId = String(body.runId);
      const thread = threads.get(threadId);
      const messages = body.messages as Array<{ content: string }>;
      if (!thread || messages.length !== 1) {
        response.writeHead(400);
        response.end('{}');
        return;
      }
      const content = messages[0].content;
      if (content === 'http-error') {
        response.writeHead(503);
        response.end(JSON.stringify({ debug: privateMarker }));
        return;
      }
      thread.turns.push(content);
      const nativeRunId = randomUUID();
      thread.runs.set(nativeRunId, 'running');
      response.setHeader('content-type', 'text/event-stream; charset=utf-8');
      const emit = (value: unknown) =>
        response.write(`data: ${JSON.stringify(value)}\n\n`);
      emit({ type: 'RUN_STARTED', threadId, runId, debug: privateMarker });
      if (content !== 'missing-native') {
        emit({
          type: 'CUSTOM',
          name: 'native_run',
          value: { run_id: nativeRunId },
        });
      }
      emit({
        type: 'CUSTOM',
        name: 'internal_debug',
        value: { secret: privateMarker },
      });
      const text = (id: string, value: string) => {
        emit({ type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' });
        emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: value });
        emit({ type: 'TEXT_MESSAGE_END', messageId: id });
      };
      if (content === 'tools') {
        text('assistant-before-tool', 'Checking.');
        emit({
          type: 'TOOL_CALL_START',
          toolCallId: 'call-one',
          toolCallName: 'arithmetic',
        });
        emit({
          type: 'TOOL_CALL_ARGS',
          toolCallId: 'call-one',
          delta: `{"secret":"${privateMarker}"}`,
        });
        emit({ type: 'TOOL_CALL_END', toolCallId: 'call-one' });
        emit({
          type: 'TOOL_CALL_RESULT',
          toolCallId: 'call-one',
          messageId: 'tool-one',
          role: 'tool',
          content: privateMarker,
        });
      }
      const answer =
        content === 'persist-failure'
          ? 'persist-retry-answer'
          : content === 'slow-save'
            ? 'slow-save-answer'
            : `synthetic answer ${thread.turns.length}`;
      text('assistant-final', answer);
      const finish = () => {
        if (response.writableEnded) return;
        thread.runs.set(nativeRunId, 'success');
        emit({ type: 'RUN_FINISHED', threadId, runId });
        response.end();
        pending.delete(nativeRunId);
      };
      if (content.startsWith('hold')) {
        pending.set(nativeRunId, finish);
        return;
      }
      if (content === 'eof' || content === 'missing-native') {
        thread.runs.set(nativeRunId, 'success');
        response.end();
        return;
      }
      if (
        ['error', 'RUN_INCOMPLETE', 'AGENT_STREAM_FAILED'].includes(content)
      ) {
        thread.runs.set(nativeRunId, content === 'error' ? 'error' : 'running');
        emit({
          type: 'RUN_ERROR',
          code: content === 'error' ? 'AGENT_RUN_FAILED' : content,
          message: privateMarker,
        });
        response.end();
        return;
      }
      finish();
    });
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
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
      'INSERT INTO auth_users (id,name,email) VALUES ($1,$2,$3)',
      [id, marker, `${id}@example.invalid`]
    );
    await database.query(
      'INSERT INTO profiles (id,email,role,status) VALUES ($1,$2,$3,$4)',
      [id, `${id}@example.invalid`, index === 3 ? 'admin' : 'user', 'active']
    );
    await database.query(
      "INSERT INTO auth_sessions (user_id,token,expires_at) VALUES ($1,$2,NOW()+interval '1 hour')",
      [id, tokens[index]]
    );
  }
  const address = upstream.address() as AddressInfo;
  await database.query(
    `INSERT INTO providers (id,name,type,base_url,auth_type) VALUES ($1,$2,'langchain',$3,'bearer')`,
    [providerId, marker, `http://127.0.0.1:${address.port}`]
  );
  await database.query('INSERT INTO groups (id,name) VALUES ($1,$2)', [
    groupId,
    marker,
  ]);
  for (const [index, id] of applications.entries()) {
    await database.query(
      `INSERT INTO service_instances (id,provider_id,instance_id,api_path,visibility,config)
      VALUES ($1,$2,$3,$4,'group_only',$5)`,
      [
        id,
        providerId,
        `${marker}-${index}`,
        `/${privateMarker}`,
        {
          backend_type: 'langchain',
          langchain: {
            assistant_id: 'agent',
            token: privateMarker,
            base_url: privateMarker,
          },
          app_metadata: {
            app_type: 'marketplace',
            brief_description: 'Synthetic test Agent',
            api_key: privateMarker,
          },
          api_key: privateMarker,
        },
      ]
    );
    if (index !== 2)
      await database.query(
        `INSERT INTO api_keys (provider_id,service_instance_id,key_value,is_default)
      VALUES ($1,$2,$3,TRUE)`,
        [providerId, id, serviceKey]
      );
    await database.query(
      'INSERT INTO group_app_permissions (group_id,service_instance_id) VALUES ($1,$2)',
      [groupId, id]
    );
  }
  for (const id of actors)
    await database.query(
      'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2)',
      [groupId, id]
    );
  const scopedUrl = new URL(databaseUrl);
  scopedUrl.searchParams.set('options', `-c role=${roleName}`);
  process.env.DATABASE_URL = scopedUrl.toString();
  process.env.APP_RLS_STRICT_MODE = 'true';
  process.env.FASTIFY_SESSION_IDENTITY_CACHE_TTL_MS = '1000';
  process.env.APP_CAPACITY_TOKEN = capacityToken;
  process.env.AGENT_MAX_ACTIVE_PER_USER = '1';
  process.env.AGENT_MAX_ACTIVE_PER_APP = '2';
  delete (globalThis as Record<string, unknown>)
    .__agentifui_fastify_session_resolver_cache__;
  for (let index = 0; index < 2; index++) {
    const app = await createApiServer(config);
    await app.listen({ host: '127.0.0.1', port: 0 });
    servers.push(app);
  }
}, 30000);

beforeEach(() => {
  upstreamRequests.length = 0;
});

afterEach(async () => {
  await finishPending();
  await database.query(`DROP TRIGGER IF EXISTS ${triggerName} ON messages`);
  await database.query(`DROP FUNCTION IF EXISTS ${triggerName}()`);
  await database.query(
    'DELETE FROM agent_submissions WHERE user_id = ANY($1::uuid[])',
    [actors]
  );
  await database.query(
    'DELETE FROM conversations WHERE user_id = ANY($1::uuid[])',
    [actors]
  );
  threads.clear();
});

afterAll(async () => {
  for (const finish of pending.values()) finish();
  await Promise.all(servers.map(server => server.close()));
  if (upstream)
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  global.fetch = originalFetch;
  const state = globalThis as Record<string, unknown>;
  if (state.__agentifui_fastify_pg_pool__) await getPgPool().end();
  delete state.__agentifui_fastify_pg_pool__;
  delete state.__agentifui_fastify_session_resolver_cache__;
  if (database) {
    await database.query('DELETE FROM profiles WHERE id = ANY($1::uuid[])', [
      actors,
    ]);
    await database.query('DELETE FROM auth_users WHERE id = ANY($1::uuid[])', [
      actors,
    ]);
    await database.query('DELETE FROM groups WHERE id = $1', [groupId]);
    await database.query('DELETE FROM providers WHERE id = $1', [providerId]);
    await database.query(`DROP OWNED BY ${roleName}`);
    await database.query(`DROP ROLE ${roleName}`);
    await database.end();
  }
  for (const key of [
    'DATABASE_URL',
    'APP_RLS_STRICT_MODE',
    'FASTIFY_SESSION_IDENTITY_CACHE_TTL_MS',
    'APP_CAPACITY_TOKEN',
    'AGENT_MAX_ACTIVE_PER_USER',
    'AGENT_MAX_ACTIVE_PER_APP',
  ]) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});

it('exercises FORCE RLS with a non-superuser role and no implicit legacy access', async () => {
  const identity = await getPgPool().query(
    'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user'
  );
  expect(identity.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  const response = await submit(0);
  const ids = accepted(response.body);
  expect((await getPgPool().query('SELECT * FROM backend_runs')).rows).toEqual(
    []
  );
  expect(
    (await getPgPool().query('SELECT * FROM backend_conversations')).rows
  ).toEqual([]);
  expect((await getStoredRun(ids.runId)).execution_status).toBe('success');
});

it('settles an attached legacy run when the old API writes a terminal status without charging or executing twice', async () => {
  const submissionId = randomUUID();
  const first = await submit(0, 'legacy running operation', { submissionId });
  const ids = accepted(first.body);
  const usage = (
    await database.query(
      'SELECT used_count FROM group_app_permissions WHERE group_id=$1 AND service_instance_id=$2',
      [groupId, applications[0]]
    )
  ).rows[0].used_count;
  await database.query('DELETE FROM agent_submissions WHERE run_id=$1', [
    ids.runId,
  ]);
  await database.query(
    "UPDATE backend_runs SET execution_status='running' WHERE id=$1",
    [ids.runId]
  );
  const replay = await submit(0, 'legacy running operation', {
    submissionId,
    server: 1,
  });
  expect(accepted(replay.body).runId).toBe(ids.runId);
  expect(
    (
      await database.query(
        'SELECT state,quota_state FROM agent_submissions WHERE run_id=$1',
        [ids.runId]
      )
    ).rows[0]
  ).toEqual({ state: 'unknown', quota_state: 'none' });
  await database.query(
    "UPDATE backend_runs SET execution_status='success' WHERE id=$1",
    [ids.runId]
  );
  expect(
    (
      await database.query(
        'SELECT state,quota_state FROM agent_submissions WHERE run_id=$1',
        [ids.runId]
      )
    ).rows[0]
  ).toEqual({ state: 'finished', quota_state: 'none' });
  const again = await submit(0, 'legacy running operation', { submissionId });
  expect(accepted(again.body).runId).toBe(ids.runId);
  expect(
    (
      await database.query(
        'SELECT used_count FROM group_app_permissions WHERE group_id=$1 AND service_instance_id=$2',
        [groupId, applications[0]]
      )
    ).rows[0].used_count
  ).toBe(usage);
  await expect(
    database.query('UPDATE service_instances SET instance_id=$2 WHERE id=$1', [
      applications[0],
      `${marker}-legacy-finished`,
    ])
  ).resolves.toBeDefined();
  await database.query(
    'UPDATE service_instances SET instance_id=$2 WHERE id=$1',
    [applications[0], `${marker}-0`]
  );
  expect(modelCalls()).toHaveLength(1);
});

it('authorizes entry, reports capabilities and never returns private config or service credentials', async () => {
  expect(
    (await servers[0].inject(`/api/internal/apps/${applications[0]}/agent`))
      .statusCode
  ).toBe(401);
  const entry = await request(0, `/api/internal/apps/${applications[0]}/agent`);
  expect(entry.statusCode).toBe(200);
  expect(entry.json().capabilities).toMatchObject({
    text: true,
    cancellation: false,
    files: false,
  });
  const detail = await request(0, `/api/internal/apps?instanceId=${marker}-0`);
  const grouped = await action(0, 'groups.getUserAccessibleApps', {});
  expect(detail.statusCode).toBe(200);
  expect(grouped.statusCode).toBe(200);
  for (const response of [entry, detail, grouped]) {
    expect(response.body).not.toContain(privateMarker);
    expect(response.body).not.toContain(serviceKey);
    expect(response.body).not.toContain('/threads');
  }
  expect(
    (await request(0, `/api/internal/apps/${applications[2]}/agent`)).statusCode
  ).toBe(503);
  expect(modelCalls()).toHaveLength(0);
});

it('persists two turns, multiple assistants and safe tool summaries exactly once in one native thread', async () => {
  const first = await submit(0, 'tools');
  expect(first.statusCode).toBe(200);
  const ids = accepted(first.body);
  expect(events(first.body).at(-1)).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'saved',
  });
  expect(first.body).not.toContain(privateMarker);
  expect(
    events(first.body).filter(event => event.type === 'tool')
  ).toHaveLength(2);
  const second = await submit(0, 'second turn', {
    conversationId: ids.conversationId,
    server: 1,
  });
  expect(events(second.body).at(-1)).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'saved',
  });
  const calls = modelCalls();
  expect(calls).toHaveLength(2);
  expect(calls[0].body.threadId).toBe(calls[1].body.threadId);
  expect(calls.map(call => call.body.messages)).toEqual([
    [{ id: expect.any(String), role: 'user', content: 'tools' }],
    [{ id: expect.any(String), role: 'user', content: 'second turn' }],
  ]);
  for (const call of calls) {
    expect(call.body.state).toEqual({});
    expect(call.body.tools).toEqual([]);
    expect(call.body.context).toEqual([]);
    expect(call.body.forwardedProps).toEqual({});
  }
  const history = await request(
    0,
    `/api/internal/apps/${applications[0]}/agent/conversations/${ids.conversationId}`,
    1
  );
  expect(history.statusCode).toBe(200);
  expect(
    history
      .json()
      .messages.map((message: { role: string; content: string }) => [
        message.role,
        message.content,
      ])
  ).toEqual([
    ['user', 'tools'],
    ['assistant', 'Checking.'],
    ['assistant', 'synthetic answer 1'],
    ['user', 'second turn'],
    ['assistant', 'synthetic answer 2'],
  ]);
  expect(history.body).not.toContain(privateMarker);
  const stored = await database.query(
    'SELECT * FROM messages WHERE conversation_id=$1 ORDER BY sequence_index',
    [ids.conversationId]
  );
  expect(stored.rows.map(row => row.sequence_index)).toEqual([0, 1, 2, 3, 4]);
  expect(new Set(stored.rows.map(row => row.id)).size).toBe(5);
  const run = await getStoredRun(ids.runId);
  expect(run.native_run_id).not.toBe(run.id);
  expect(
    (
      await database.query('SELECT app_id FROM conversations WHERE id=$1', [
        ids.conversationId,
      ])
    ).rows[0].app_id
  ).toBe(applications[0]);
});

it('denies another user, another app and forged native identifiers without upstream calls', async () => {
  const first = await submit(0);
  const ids = accepted(first.body);
  const count = upstreamRequests.length;
  for (const actor of [1, 3]) {
    expect(
      (
        await request(
          actor,
          `/api/internal/apps/${applications[0]}/agent/runs/${ids.runId}`
        )
      ).statusCode
    ).toBe(404);
    expect(
      (
        await request(
          actor,
          `/api/internal/apps/${applications[0]}/agent/conversations/${ids.conversationId}`
        )
      ).statusCode
    ).toBe(404);
    expect(
      (await submit(actor, 'forbidden', { conversationId: ids.conversationId }))
        .statusCode
    ).toBe(409);
  }
  expect(
    (
      await submit(0, 'cross app', {
        app: 1,
        conversationId: ids.conversationId,
      })
    ).statusCode
  ).toBe(409);
  expect(
    (
      await request(
        0,
        `/api/internal/apps/${applications[1]}/agent/runs/${ids.runId}`
      )
    ).statusCode
  ).toBe(404);
  expect(
    (
      await submit(0, 'native forged', {
        extra: { threadId: randomUUID(), nativeRunId: randomUUID() },
      })
    ).statusCode
  ).toBe(400);
  expect(upstreamRequests).toHaveLength(count);
});

it('blocks generic writes to server-managed conversations and trusted tables while preserving history reads', async () => {
  const ids = accepted((await submit(0)).body);
  for (const actor of [0, 1]) {
    expect(
      (
        await action(actor, 'messages.save', {
          message: {
            conversation_id: ids.conversationId,
            role: 'assistant',
            content: 'forged',
          },
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await action(actor, 'messages.createPlaceholder', {
          conversationId: ids.conversationId,
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await action(actor, 'messages.updateMetadata', {
          conversationId: ids.conversationId,
          messageId: randomUUID(),
          metadata: { thread_id: 'forged' },
        })
      ).statusCode
    ).toBe(404);
  }
  for (const appId of [
    applications[0],
    applications[0].toUpperCase(),
    `${marker}-0`,
  ]) {
    expect(
      (
        await action(0, 'conversations.createConversation', {
          conversation: { app_id: appId, title: 'forged' },
        })
      ).statusCode
    ).toBe(409);
  }
  for (const name of [
    'backend_runs.update',
    'backend_conversations.create',
    'crud.update',
  ]) {
    expect(
      (
        await action(3, name, {
          table: 'backend_runs',
          id: ids.runId,
          data: { native_run_id: 'forged' },
        })
      ).statusCode
    ).toBe(403);
  }
  const read = await action(0, 'messages.getLatest', {
    conversationId: ids.conversationId,
  });
  expect(read.statusCode).toBe(200);
  expect(read.json().data).toHaveLength(2);
  expect(
    (
      await action(1, 'messages.getLatest', {
        conversationId: ids.conversationId,
      })
    ).statusCode
  ).toBe(404);
  expect(
    (
      await database.query(
        'SELECT count(*)::int AS count FROM messages WHERE conversation_id=$1',
        [ids.conversationId]
      )
    ).rows[0].count
  ).toBe(2);
});

it('keeps non-UUID application identifiers case-sensitive for generic creation', async () => {
  const instanceId = `CaseSensitive-${marker}`;
  await database.query(
    'UPDATE service_instances SET instance_id=$2 WHERE id=$1',
    [applications[0], instanceId]
  );
  try {
    expect(
      (
        await action(0, 'conversations.createConversation', {
          conversation: { app_id: instanceId, title: 'Exact synthetic app' },
        })
      ).statusCode
    ).toBe(409);
    const different = await action(0, 'conversations.createConversation', {
      conversation: {
        app_id: instanceId.toLowerCase(),
        title: 'Different synthetic identifier',
      },
    });
    expect(different.statusCode).toBe(200);
    expect(different.json().data.app_id).toBe(instanceId.toLowerCase());
    expect(
      (
        await database.query(
          'SELECT count(*)::int AS count FROM backend_conversations WHERE service_instance_id=ANY($1::uuid[])',
          [applications]
        )
      ).rows[0].count
    ).toBe(0);
  } finally {
    await database.query(
      'UPDATE service_instances SET instance_id=$2 WHERE id=$1',
      [applications[0], `${marker}-0`]
    );
  }
});

it.each([
  { change: 'permission', replay: false },
  { change: 'provider', replay: false },
  { change: 'assistant', replay: false },
  { change: 'role', replay: false },
  { change: 'permission', replay: true },
])(
  'rechecks live $change after advisory-lock waiting, replay=$replay',
  async ({ change, replay }) => {
    const actor = change === 'role' ? 3 : 0;
    const submissionId = randomUUID();
    if (replay)
      expect(
        (await submit(actor, 'lock wait test', { submissionId })).statusCode
      ).toBe(200);
    if (change === 'role')
      await database.query(
        "UPDATE service_instances SET visibility='private' WHERE id=$1",
        [applications[0]]
      );
    const holder = await database.connect();
    let released = false;
    await holder.query('BEGIN');
    const holderId = (await holder.query('SELECT pg_backend_pid() AS pid'))
      .rows[0].pid;
    await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `agent-user:${actors[actor]}`,
    ]);
    const waitingRequest = submit(actor, 'lock wait test', {
      submissionId,
      server: 1,
    });
    try {
      await waitFor(
        async () =>
          (
            await database.query(
              `SELECT count(*)::int AS count FROM pg_locks waiting
      WHERE waiting.locktype='advisory' AND NOT waiting.granted AND (waiting.classid,waiting.objid) IN
      (SELECT classid,objid FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted)`,
              [holderId]
            )
          ).rows[0].count as number,
        count => count > 0
      );
      if (change === 'permission')
        await database.query(
          'UPDATE group_app_permissions SET is_enabled=FALSE WHERE group_id=$1 AND service_instance_id=$2',
          [groupId, applications[0]]
        );
      if (change === 'provider')
        await database.query(
          'UPDATE providers SET is_active=FALSE WHERE id=$1',
          [providerId]
        );
      if (change === 'assistant')
        await database.query(
          `UPDATE service_instances SET config=jsonb_set(config,'{langchain,assistant_id}','"changed-agent"') WHERE id=$1`,
          [applications[0]]
        );
      if (change === 'role')
        await database.query("UPDATE profiles SET role='user' WHERE id=$1", [
          actors[actor],
        ]);
      const callsBefore = modelCalls().length;
      await holder.query('COMMIT');
      released = true;
      const response = await waitingRequest;
      expect(response.statusCode).toBe(change === 'assistant' ? 409 : 404);
      expect(modelCalls()).toHaveLength(callsBefore);
      const runs = await database.query(
        'SELECT count(*)::int AS count FROM backend_runs WHERE user_id=$1 AND submission_id=$2',
        [actors[actor], submissionId]
      );
      expect(runs.rows[0].count).toBe(replay ? 1 : 0);
    } finally {
      if (!released) await holder.query('ROLLBACK');
      holder.release();
      await waitingRequest.catch(() => undefined);
      if (change === 'permission')
        await database.query(
          'UPDATE group_app_permissions SET is_enabled=TRUE WHERE group_id=$1 AND service_instance_id=$2',
          [groupId, applications[0]]
        );
      if (change === 'provider')
        await database.query(
          'UPDATE providers SET is_active=TRUE WHERE id=$1',
          [providerId]
        );
      if (change === 'assistant')
        await database.query(
          `UPDATE service_instances SET config=jsonb_set(config,'{langchain,assistant_id}','"agent"') WHERE id=$1`,
          [applications[0]]
        );
      if (change === 'role') {
        await database.query("UPDATE profiles SET role='admin' WHERE id=$1", [
          actors[actor],
        ]);
        await database.query(
          "UPDATE service_instances SET visibility='group_only' WHERE id=$1",
          [applications[0]]
        );
      }
    }
  }
);

it('rechecks group and provider access for new runs, status and generic history', async () => {
  const ids = accepted((await submit(0)).body);
  const denied = async () => {
    const count = upstreamRequests.length;
    expect(
      (await submit(0, 'revoked', { conversationId: ids.conversationId }))
        .statusCode
    ).toBe(404);
    expect(
      (
        await request(
          0,
          `/api/internal/apps/${applications[0]}/agent/runs/${ids.runId}`
        )
      ).statusCode
    ).toBe(404);
    expect(
      (
        await action(0, 'messages.getLatest', {
          conversationId: ids.conversationId,
        })
      ).statusCode
    ).toBe(404);
    expect(upstreamRequests).toHaveLength(count);
  };
  await database.query(
    'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2',
    [groupId, actors[0]]
  );
  try {
    await denied();
  } finally {
    await database.query(
      'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2)',
      [groupId, actors[0]]
    );
  }
  await database.query('UPDATE providers SET is_active=FALSE WHERE id=$1', [
    providerId,
  ]);
  try {
    await denied();
  } finally {
    await database.query('UPDATE providers SET is_active=TRUE WHERE id=$1', [
      providerId,
    ]);
  }
});

it('rejects a suspended account after cache expiry without invoking the model', async () => {
  const ids = accepted((await submit(0)).body);
  await database.query("UPDATE profiles SET status='suspended' WHERE id=$1", [
    actors[0],
  ]);
  try {
    await new Promise(resolve => setTimeout(resolve, 1050));
    const count = modelCalls().length;
    expect(
      (await submit(0, 'disabled', { conversationId: ids.conversationId }))
        .statusCode
    ).toBe(401);
    expect(modelCalls()).toHaveLength(count);
  } finally {
    await database.query("UPDATE profiles SET status='active' WHERE id=$1", [
      actors[0],
    ]);
  }
});

it('deduplicates simultaneous first submissions across two API instances before conversation allocation', async () => {
  const submissionId = randomUUID();
  const first = submit(0, 'hold-race', { submissionId });
  await waitFor(
    () => pending.size,
    size => size === 1
  );
  const replay = await submit(0, 'hold-race', { submissionId, server: 1 });
  expect(replay.statusCode).toBe(200);
  const replayIds = accepted(replay.body);
  expect(modelCalls()).toHaveLength(1);
  expect(
    (await submit(0, 'changed', { submissionId, server: 1 })).statusCode
  ).toBe(409);
  await finishPending();
  const firstResponse = await first;
  expect(accepted(firstResponse.body)).toMatchObject({
    runId: replayIds.runId,
    conversationId: replayIds.conversationId,
  });
  expect(
    (
      await database.query(
        'SELECT count(*)::int AS count FROM conversations WHERE user_id=$1',
        [actors[0]]
      )
    ).rows[0].count
  ).toBe(1);
  expect(
    (
      await database.query(
        'SELECT count(*)::int AS count FROM messages WHERE conversation_id=$1',
        [replayIds.conversationId]
      )
    ).rows[0].count
  ).toBe(2);
  expect(
    events((await submit(0, 'hold-race', { submissionId, server: 1 })).body).at(
      -1
    )
  ).toMatchObject({ executionStatus: 'success', persistenceStatus: 'saved' });
  expect(modelCalls()).toHaveLength(1);
});

it('admits only one reservation when both replicas receive a new submission simultaneously', async () => {
  const submissionId = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      submit(0, 'parallel first request', { submissionId, server: index % 2 })
    )
  );
  for (const response of responses) expect(response.statusCode).toBe(200);
  const references = responses.map(response => accepted(response.body));
  expect(new Set(references.map(item => item.runId)).size).toBe(1);
  expect(new Set(references.map(item => item.conversationId)).size).toBe(1);
  expect(modelCalls()).toHaveLength(1);
  expect(
    (
      await database.query(
        'SELECT count(*)::int AS count FROM backend_runs WHERE user_id=$1 AND submission_id=$2',
        [actors[0], submissionId]
      )
    ).rows[0].count
  ).toBe(1);
});

it('enforces one active user and two active app runs across instances', async () => {
  const first = submit(0, 'hold-one');
  await waitFor(
    () => pending.size,
    size => size === 1
  );
  expect(
    (await submit(0, 'other app same user', { server: 1, app: 1 })).statusCode
  ).toBe(429);
  const second = submit(1, 'hold-two', { server: 1 });
  await waitFor(
    () => pending.size,
    size => size === 2
  );
  expect((await submit(2, 'app full', { server: 1 })).statusCode).toBe(429);
  expect(modelCalls()).toHaveLength(2);
  await finishPending();
  await Promise.all([first, second]);
  expect(
    events((await submit(2, 'released capacity', { server: 1 })).body).at(-1)
  ).toMatchObject({ executionStatus: 'success' });
});

it('still prevents two active generations in one conversation when user capacity is larger', async () => {
  const ids = accepted((await submit(0)).body);
  process.env.AGENT_MAX_ACTIVE_PER_USER = '2';
  const first = submit(0, 'hold-conversation', {
    conversationId: ids.conversationId,
  });
  try {
    await waitFor(
      () => pending.size,
      size => size === 1
    );
    const count = modelCalls().length;
    expect(
      (
        await submit(0, 'overlap same conversation', {
          server: 1,
          conversationId: ids.conversationId,
        })
      ).statusCode
    ).toBe(409);
    expect(modelCalls()).toHaveLength(count);
  } finally {
    await finishPending();
    await first;
    process.env.AGENT_MAX_ACTIVE_PER_USER = '1';
  }
});

it.each(['eof', 'missing-native', 'http-error'])(
  'keeps %s uncertain, never retries generation and retains the user slot',
  async content => {
    const submissionId = randomUUID();
    const response = await submit(0, content, { submissionId });
    const ids = accepted(response.body);
    expect(events(response.body).at(-1)).toMatchObject({
      executionStatus: 'unknown',
      persistenceStatus: 'saved',
    });
    expect(modelCalls()).toHaveLength(1);
    const replay = await submit(0, content, { submissionId, server: 1 });
    expect(accepted(replay.body).runId).toBe(ids.runId);
    expect(modelCalls()).toHaveLength(1);
    expect(
      (await submit(0, 'must not overlap', { server: 1 })).statusCode
    ).toBe(429);
    const status = await request(
      0,
      `/api/internal/apps/${applications[0]}/agent/runs/${ids.runId}`
    );
    expect(status.json().executionStatus).toBe('unknown');
    if (content === 'eof') expect(status.json().upstreamStatus).toBe('success');
  }
);

it('treats HTTP 200 RUN_ERROR as failure, saves partial text and redacts upstream internals', async () => {
  const response = await submit(0, 'error');
  const ids = accepted(response.body);
  expect(events(response.body).at(-1)).toMatchObject({
    executionStatus: 'error',
    persistenceStatus: 'saved',
    errorCode: 'AGENT_RUN_FAILED',
  });
  expect(response.body).not.toContain(privateMarker);
  expect((await getStoredRun(ids.runId)).execution_status).toBe('error');
  expect(
    events((await submit(0, 'next after known failure')).body).at(-1)
  ).toMatchObject({ executionStatus: 'success' });
});

it.each(['RUN_INCOMPLETE', 'AGENT_STREAM_FAILED'])(
  'retains the active reservation when a terminal %s does not confirm native execution',
  async code => {
    const submissionId = randomUUID();
    const response = await submit(0, code, { submissionId });
    const ids = accepted(response.body);
    expect(events(response.body).at(-1)).toMatchObject({
      executionStatus: 'unknown',
      persistenceStatus: 'saved',
      errorCode: code,
    });
    expect((await getStoredRun(ids.runId)).execution_status).toBe('unknown');
    expect(response.body).not.toContain(privateMarker);
    expect(
      (await submit(0, 'no overlapping execution', { server: 1 })).statusCode
    ).toBe(429);
    const replay = await submit(0, code, { server: 1, submissionId });
    expect(accepted(replay.body).runId).toBe(ids.runId);
    expect(events(replay.body).at(-1)).toMatchObject({
      executionStatus: 'unknown',
    });
    const status = await request(
      0,
      `/api/internal/apps/${applications[0]}/agent/runs/${ids.runId}`,
      1
    );
    expect(status.json()).toMatchObject({
      executionStatus: 'unknown',
      upstreamStatus: 'running',
    });
    expect(modelCalls()).toHaveLength(1);
  }
);

it('continues saving after a real browser disconnect and retains capacity background tracking', async () => {
  const port = (servers[0].server.address() as AddressInfo).port;
  const body = JSON.stringify({
    submissionId: randomUUID(),
    content: 'hold-disconnect',
  });
  const ids = await new Promise<
    ClientEvent & { runId: string; conversationId: string }
  >((resolve, reject) => {
    const client = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: `/api/internal/apps/${applications[0]}/agent/runs`,
        method: 'POST',
        headers: {
          cookie: `session_token=${tokens[0]}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      response => {
        let received = '';
        response.on('data', chunk => {
          received += chunk.toString();
          if (!received.includes('\n\n')) return;
          const item = accepted(received);
          resolve(item);
          response.destroy();
          client.destroy();
        });
        response.on('error', () => undefined);
      }
    );
    client.on('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
    });
    client.end(body);
  });
  await waitFor(
    () => pending.size,
    size => size === 1
  );
  const capacity = await servers[0].inject({
    method: 'GET',
    url: '/__agentifui/capacity',
    headers: { authorization: `Bearer ${capacityToken}` },
  });
  expect(capacity.statusCode).toBe(200);
  expect(capacity.json().backgroundTasks).toBeGreaterThan(0);
  expect((await submit(0, 'still running', { server: 1 })).statusCode).toBe(
    429
  );
  await finishPending();
  await waitFor(
    () => getStoredRun(ids.runId),
    run => run.persistence_status === 'saved'
  );
  const history = await request(
    0,
    `/api/internal/apps/${applications[0]}/agent/conversations/${ids.conversationId}`,
    1
  );
  expect(history.json().messages).toHaveLength(2);
  expect(history.json().runs[0]).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'saved',
  });
});

async function installSaveTrigger(mode: 'failure' | 'slow') {
  const statement =
    mode === 'failure'
      ? "RAISE EXCEPTION 'synthetic persistence failure';"
      : 'PERFORM pg_sleep(0.3);';
  const content =
    mode === 'failure' ? 'persist-retry-answer' : 'slow-save-answer';
  await database.query(`CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.user_id='${actors[0]}'::uuid AND NEW.role='assistant' AND NEW.content='${content}'
    THEN ${statement} END IF; RETURN NEW; END; $$`);
  await database.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION ${triggerName}()`);
}

it('retries only known result persistence after an injected database failure, never the model', async () => {
  await installSaveTrigger('failure');
  const response = await submit(0, 'persist-failure');
  const ids = accepted(response.body);
  expect(events(response.body).at(-1)).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'failed',
  });
  const stored = await getStoredRun(ids.runId);
  expect(stored.result.messages[0].content).toBe('persist-retry-answer');
  expect(stored.persistence_status).toBe('failed');
  expect(modelCalls()).toHaveLength(1);
  await database.query(`DROP TRIGGER ${triggerName} ON messages`);
  const status = await request(
    0,
    `/api/internal/apps/${applications[0]}/agent/runs/${ids.runId}`,
    1
  );
  expect(status.json()).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'saved',
  });
  expect(modelCalls()).toHaveLength(1);
  const history = await request(
    0,
    `/api/internal/apps/${applications[0]}/agent/conversations/${ids.conversationId}`
  );
  expect(history.json().messages).toHaveLength(2);
});

it('recovers a pending snapshot after a simulated pre-history crash without executing the model again', async () => {
  const ids = accepted((await submit(0, 'recover pending snapshot')).body);
  const saved = await getStoredRun(ids.runId);
  const assistantId = saved.result.messages[0].id;
  await database.query(
    "DELETE FROM messages WHERE conversation_id=$1 AND role='assistant'",
    [ids.conversationId]
  );
  await database.query(
    "UPDATE backend_runs SET persistence_status='pending' WHERE id=$1",
    [ids.runId]
  );
  const previousRequests = upstreamRequests.length;
  const responses = await Promise.all(
    [0, 1].map(server =>
      request(
        0,
        `/api/internal/apps/${applications[0]}/agent/runs/${ids.runId}`,
        server
      )
    )
  );
  for (const response of responses) {
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      executionStatus: 'success',
      persistenceStatus: 'saved',
    });
  }
  expect(upstreamRequests).toHaveLength(previousRequests);
  expect(modelCalls()).toHaveLength(1);
  const messages = await database.query(
    'SELECT id,role,content FROM messages WHERE conversation_id=$1 ORDER BY sequence_index',
    [ids.conversationId]
  );
  expect(messages.rows).toHaveLength(2);
  expect(messages.rows[1]).toMatchObject({
    id: assistantId,
    role: 'assistant',
    content: saved.result.messages[0].content,
  });
  expect((await getStoredRun(ids.runId)).persistence_status).toBe('saved');
});

it('waits for slow database persistence before reporting saved', async () => {
  await installSaveTrigger('slow');
  const response = await submit(0, 'slow-save');
  const ids = accepted(response.body);
  expect(events(response.body).at(-1)).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'saved',
  });
  expect((await getStoredRun(ids.runId)).persistence_status).toBe('saved');
  expect(modelCalls()).toHaveLength(1);
});

it('refuses backend switching, binding mutation, native thread reuse and deletion of referenced apps', async () => {
  const ids = accepted((await submit(0)).body);
  await expect(
    database.query(
      `UPDATE service_instances SET config=jsonb_set(config,'{backend_type}','"dify"') WHERE id=$1`,
      [applications[0]]
    )
  ).rejects.toMatchObject({ code: '23514' });
  const binding = (
    await database.query(
      'SELECT thread_id,config_fingerprint FROM backend_conversations WHERE conversation_id=$1',
      [ids.conversationId]
    )
  ).rows[0];
  const duplicateConversation = randomUUID();
  await database.query(
    'INSERT INTO conversations (id,user_id,title,app_id) VALUES ($1,$2,$3,$4)',
    [
      duplicateConversation,
      actors[0],
      'Synthetic duplicate binding',
      applications[0],
    ]
  );
  await expect(
    database.query(
      `INSERT INTO backend_conversations (conversation_id,service_instance_id,config_fingerprint,thread_id)
      VALUES ($1,$2,$3,$4)`,
      [
        duplicateConversation,
        applications[0],
        binding.config_fingerprint,
        binding.thread_id,
      ]
    )
  ).rejects.toMatchObject({ code: '23505' });
  await expect(
    database.query(
      `UPDATE backend_conversations SET thread_id='forged' WHERE conversation_id=$1`,
      [ids.conversationId]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    database.query('DELETE FROM service_instances WHERE id=$1', [
      applications[0],
    ])
  ).rejects.toMatchObject({ code: '23001' });
});

it('detects changed service identity rather than silently creating a replacement thread', async () => {
  const ids = accepted((await submit(0)).body);
  await database.query(
    `UPDATE service_instances SET config=jsonb_set(config,'{langchain,assistant_id}','"changed-agent"') WHERE id=$1`,
    [applications[0]]
  );
  try {
    const count = upstreamRequests.length;
    expect(
      (await submit(0, 'no remap', { conversationId: ids.conversationId }))
        .statusCode
    ).toBe(409);
    expect(
      (
        await request(
          0,
          `/api/internal/apps/${applications[0]}/agent/runs/${ids.runId}`
        )
      ).statusCode
    ).toBe(409);
    expect(upstreamRequests).toHaveLength(count);
  } finally {
    await database.query(
      `UPDATE service_instances SET config=jsonb_set(config,'{langchain,assistant_id}','"agent"') WHERE id=$1`,
      [applications[0]]
    );
  }
});

it('continues the same bound thread after a same-service credential rotation', async () => {
  const ids = accepted((await submit(0)).body);
  await database.query(
    'UPDATE api_keys SET key_value=$2 WHERE service_instance_id=$1',
    [applications[0], `${serviceKey}-rotated`]
  );
  try {
    const response = await submit(0, 'continue after credential rotation', {
      conversationId: ids.conversationId,
      server: 1,
    });
    expect(response.statusCode).toBe(200);
    expect(events(response.body).at(-1)).toMatchObject({
      executionStatus: 'success',
      persistenceStatus: 'saved',
    });
    expect(modelCalls()).toHaveLength(2);
    expect(modelCalls()[0].body.threadId).toBe(modelCalls()[1].body.threadId);
  } finally {
    await database.query(
      'UPDATE api_keys SET key_value=$2 WHERE service_instance_id=$1',
      [applications[0], serviceKey]
    );
  }
});

it('soft-deletes only the owned local conversation and does not claim upstream memory deletion', async () => {
  const ids = accepted((await submit(0)).body);
  const response = await servers[0].inject({
    method: 'DELETE',
    url: `/api/internal/apps/${applications[0]}/agent/conversations/${ids.conversationId}`,
    headers: { cookie: `session_token=${tokens[0]}` },
  });
  expect(response.statusCode).toBe(204);
  expect(
    (
      await request(
        0,
        `/api/internal/apps/${applications[0]}/agent/conversations/${ids.conversationId}`
      )
    ).statusCode
  ).toBe(404);
  expect(threads.size).toBe(1);
  expect(
    events((await submit(0, 'new conversation')).body).at(-1)
  ).toMatchObject({ executionStatus: 'success' });
});
