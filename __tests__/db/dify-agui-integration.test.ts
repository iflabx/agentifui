/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';

import type { ApiRuntimeConfig } from '../../apps/api/src/config';
import {
  admitSubmission,
  registerSubmission,
  submissionHash,
  submissionStorage,
} from '../../apps/api/src/lib/agent-submissions';
import { getPgPool } from '../../apps/api/src/lib/pg-context';
import { createApiServer } from '../../apps/api/src/server';
import { parseAgentEvent } from '../../packages/shared/src/agui';
import { resolveTestDatabaseUrl } from './helpers/test-database-url';
import { createTestRole, dropTestRole } from './helpers/test-role';

jest.mock('../../apps/api/src/lib/error-events', () => ({
  recordApiErrorEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.setTimeout(30000);

const original = { ...process.env };
const originalFetch = global.fetch;
const actors = [randomUUID(), randomUUID(), randomUUID()];
const tokens = actors.map(() => randomUUID());
const provider = randomUUID();
const apps = [randomUUID(), randomUUID()];
const group = randomUUID();
const marker = `dify-agui-${randomUUID()}`;
const role = `dify_agui_${randomUUID().replaceAll('-', '')}`;
const trigger = `${role}_save`;
const serviceKey = 'synthetic-dify-runtime-key';
const privateMarker = 'synthetic-private-upstream-diagnostics';
const servers: Awaited<ReturnType<typeof createApiServer>>[] = [];
const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
const pending = new Map<string, () => void>();
let database: Pool;
let upstream: ReturnType<typeof createServer>;
let baseUrl: string;
let mode: unknown = 'chat';
let parameters: Record<string, unknown> = { user_input_form: [] };
let nativeThread = 0;

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

function events(body: string): Record<string, unknown>[] {
  return body
    .split(/\r?\n/)
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)));
}

async function waitFor<T>(
  operation: () => Promise<T> | T,
  accept: (value: T) => boolean
): Promise<T> {
  const until = Date.now() + 10000;
  while (true) {
    const value = await operation();
    if (accept(value)) return value;
    if (Date.now() >= until)
      throw new Error('Timed out waiting for isolated Dify condition');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function submit(
  content = 'normal',
  options: {
    actor?: number;
    app?: number;
    replica?: number;
    submissionId?: string;
    conversationId?: string;
    protocol?: string | null;
    extra?: Record<string, unknown>;
  } = {}
) {
  const protocol =
    options.protocol === undefined ? 'ag-ui/1.0' : options.protocol;
  return servers[options.replica ?? 0].inject({
    method: 'POST',
    url: `/api/internal/apps/${apps[options.app ?? 0]}/agent/runs`,
    headers: {
      cookie: `session_token=${tokens[options.actor ?? 0]}`,
      ...(protocol ? { 'x-agentifui-protocol': protocol } : {}),
    },
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

function get(path: string, actor = 0, app = 0) {
  return servers[1].inject({
    method: 'GET',
    url: `/api/internal/apps/${apps[app]}/agent/${path}`,
    headers: { cookie: `session_token=${tokens[actor]}` },
  });
}

function action(name: string, payload: Record<string, unknown>, actor = 0) {
  return servers[0].inject({
    method: 'POST',
    url: '/api/internal/data',
    headers: { cookie: `session_token=${tokens[actor]}` },
    payload: { action: name, payload },
  });
}

async function stored(response: { headers: Record<string, unknown> }) {
  return (
    await database.query(
      `SELECT r.*, b.backend_type, b.thread_id, b.config_fingerprint,
    s.state AS task_state, s.quota_state FROM backend_runs r JOIN backend_conversations b ON b.conversation_id=r.conversation_id
    JOIN agent_submissions s ON s.run_id=r.id WHERE s.root_task_id=$1`,
      [response.headers['x-agentifui-root-task-id']]
    )
  ).rows[0];
}

function generations() {
  return calls.filter(call => call.path === '/chat-messages');
}

beforeAll(async () => {
  global.fetch = jest.requireActual<{ fetch: typeof fetch }>(
    'next/dist/compiled/@edge-runtime/primitives/fetch'
  ).fetch;
  database = new Pool({ connectionString: resolveTestDatabaseUrl() });
  upstream = createServer((incoming, response) => {
    let raw = '';
    incoming.on('data', chunk => {
      raw += chunk.toString();
    });
    incoming.on('end', () => {
      const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
      const path = incoming.url || '';
      calls.push({ path, body });
      if (incoming.headers.authorization !== `Bearer ${serviceKey}`) {
        response.writeHead(401);
        response.end('{}');
        return;
      }
      if (path === '/info') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ mode, private: privateMarker }));
        return;
      }
      if (path === '/parameters') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(parameters));
        return;
      }
      if (path !== '/chat-messages') {
        response.writeHead(404);
        response.end('{}');
        return;
      }
      const content = String(body.query);
      if (content.startsWith('http-')) {
        response.writeHead(Number(content.slice(5)));
        response.end(privateMarker);
        return;
      }
      response.setHeader('content-type', 'text/event-stream');
      const conversationId =
        body.conversation_id || `native-thread-${++nativeThread}`;
      const messageId = `native-message-${randomUUID()}`;
      const taskId = `native-task-${randomUUID()}`;
      const emit = (event: string, fields: Record<string, unknown> = {}) =>
        response.write(
          `data: ${JSON.stringify({ event, conversation_id: conversationId, message_id: messageId, task_id: taskId, ...fields })}\n\n`
        );
      if (content === 'native-refusal') {
        response.write(
          `data: ${JSON.stringify({ event: 'error', code: 'invalid_param', status: 400, message: privateMarker })}\n\n`
        );
        response.end();
        return;
      }
      if (content === 'unidentified-error') {
        response.write(
          `data: ${JSON.stringify({ event: 'error', code: 'internal_error', status: 500, message: privateMarker })}\n\n`
        );
        response.end();
        return;
      }
      if (content.startsWith('malformed-before')) {
        response.write(
          `data: ${JSON.stringify({ event: 'error', ...(content.endsWith('string-status') ? { status: '400', code: 'invalid_param', message: privateMarker } : content.endsWith('missing-message') ? { status: 400, code: 'invalid_param' } : {}) })}\n\n`
        );
        response.end();
        return;
      }
      if (content === 'unknown-first')
        emit('new_extension', {
          conversation_id: 'ignored-thread',
          message_id: 'ignored-message',
        });
      emit('message', { answer: 'reply:' });
      if (content.startsWith('malformed-after')) {
        emit(
          'error',
          content.endsWith('string-status')
            ? { status: '500', code: 'internal_error', message: privateMarker }
            : {}
        );
        response.end();
        return;
      }
      if (content === 'eof') {
        response.end();
        return;
      }
      if (content === 'legacy-agent') {
        emit('agent_message', { answer: 'must-not-display' });
        response.end();
        return;
      }
      if (content === 'identity-conversation') {
        emit('message', {
          answer: 'must-not-display',
          conversation_id: 'stolen',
        });
        response.end();
        return;
      }
      if (content === 'identity-message') {
        emit('message', { answer: 'must-not-display', message_id: 'stolen' });
        response.end();
        return;
      }
      if (content === 'identity-task') {
        emit('message_end', { metadata: {}, task_id: 'stolen' });
        response.end();
        return;
      }
      const finish = () => {
        if (content === 'over-budget')
          emit('message', { answer: 'x'.repeat(66000) });
        else emit('message', { answer: content });
        if (content.startsWith('replace'))
          emit('message_replace', {
            answer: content === 'replace-empty' ? '' : 'replacement',
          });
        emit('message_end', { metadata: { usage: { total_tokens: 1 } } });
        if (content === 'late-error')
          emit('error', {
            code: 'internal_error',
            status: 500,
            message: privateMarker,
          });
        response.end();
      };
      if (content.startsWith('hold-')) pending.set(content, finish);
      else finish();
    });
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  await createTestRole(database, role);
  for (const [index, id] of actors.entries()) {
    await database.query(
      'INSERT INTO auth_users(id,name,email) VALUES($1,$2,$3)',
      [id, marker, `${id}@example.invalid`]
    );
    await database.query(
      "INSERT INTO profiles(id,email,role,status) VALUES($1,$2,'user','active')",
      [id, `${id}@example.invalid`]
    );
    await database.query(
      "INSERT INTO auth_sessions(user_id,token,expires_at) VALUES($1,$2,NOW()+interval '1 hour')",
      [id, tokens[index]]
    );
  }
  await database.query(
    "INSERT INTO providers(id,name,type,base_url,auth_type) VALUES($1,$2,'dify',$3,'bearer')",
    [provider, marker, baseUrl]
  );
  await database.query('INSERT INTO groups(id,name) VALUES($1,$2)', [
    group,
    marker,
  ]);
  for (const [index, id] of apps.entries()) {
    await database.query(
      "INSERT INTO service_instances(id,provider_id,instance_id,visibility,config) VALUES($1,$2,$3,'group_only',$4)",
      [
        id,
        provider,
        `${marker}-${index}`,
        {
          interaction_protocol: 'ag-ui/1.0',
          app_metadata: { app_type: 'marketplace', dify_apptype: 'chatbot' },
        },
      ]
    );
    await database.query(
      'INSERT INTO api_keys(provider_id,service_instance_id,key_value,is_default) VALUES($1,$2,$3,TRUE)',
      [provider, id, serviceKey]
    );
    await database.query(
      'INSERT INTO group_app_permissions(group_id,service_instance_id,usage_quota) VALUES($1,$2,100)',
      [group, id]
    );
  }
  for (const id of actors)
    await database.query(
      'INSERT INTO group_members(group_id,user_id) VALUES($1,$2)',
      [group, id]
    );
  const scoped = new URL(resolveTestDatabaseUrl());
  scoped.searchParams.set('options', `-c role=${role}`);
  process.env.DATABASE_URL = scoped.toString();
  process.env.APP_RLS_STRICT_MODE = 'true';
  process.env.AGENT_MAX_ACTIVE_PER_USER = '1';
  process.env.AGENT_MAX_ACTIVE_PER_APP = '2';
  delete (globalThis as Record<string, unknown>)
    .__agentifui_fastify_session_resolver_cache__;
  for (let index = 0; index < 2; index++) {
    const server = await createApiServer(config);
    await server.listen({ host: '127.0.0.1', port: 0 });
    servers.push(server);
  }
});

beforeEach(() => {
  calls.length = 0;
  mode = 'chat';
  parameters = { user_input_form: [] };
});

afterEach(async () => {
  for (const finish of pending.values()) finish();
  pending.clear();
  await waitFor(
    async () =>
      (
        await database.query(
          "SELECT count(*)::int AS count FROM backend_runs WHERE user_id=ANY($1::uuid[]) AND execution_status IN ('reserved','submitting','running')",
          [actors]
        )
      ).rows[0].count,
    value => value === 0
  );
  await database.query(`DROP TRIGGER IF EXISTS ${trigger} ON messages`);
  await database.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
  await database.query(
    "UPDATE backend_runs SET execution_status='error',persistence_status='saved' WHERE user_id=ANY($1::uuid[]) AND (execution_status='unknown' OR persistence_status<>'saved')",
    [actors]
  );
  await database.query(
    'DELETE FROM agent_submissions WHERE user_id=ANY($1::uuid[])',
    [actors]
  );
  await database.query(
    'DELETE FROM conversations WHERE user_id=ANY($1::uuid[])',
    [actors]
  );
  await database.query(
    'UPDATE group_app_permissions SET used_count=0 WHERE service_instance_id=ANY($1::uuid[])',
    [apps]
  );
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
    await database.query('DELETE FROM profiles WHERE id=ANY($1::uuid[])', [
      actors,
    ]);
    await database.query('DELETE FROM auth_users WHERE id=ANY($1::uuid[])', [
      actors,
    ]);
    await database.query('DELETE FROM groups WHERE id=$1', [group]);
    await database.query('DELETE FROM providers WHERE id=$1', [provider]);
    await dropTestRole(database, role);
    await database.end();
  }
  for (const name of [
    'DATABASE_URL',
    'APP_RLS_STRICT_MODE',
    'AGENT_MAX_ACTIVE_PER_USER',
    'AGENT_MAX_ACTIVE_PER_APP',
  ]) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

it('saves two negotiated turns once with trusted native identity and complete local history across API replicas', async () => {
  const first = await submit('first');
  expect(first.statusCode).toBe(200);
  const run = await stored(first);
  expect(run).toMatchObject({
    backend_type: 'dify',
    execution_status: 'success',
    persistence_status: 'saved',
    task_state: 'finished',
    quota_state: 'counted',
  });
  const second = await submit('second', {
    conversationId: run.conversation_id,
    replica: 1,
  });
  const next = await stored(second);
  expect(next.thread_id).toBe(run.thread_id);
  expect(next.native_run_id).not.toBe(run.native_run_id);
  expect(generations()).toHaveLength(2);
  for (const [index, call] of generations().entries()) {
    expect(call.body).toMatchObject({
      query: index ? 'second' : 'first',
      user: actors[0],
      inputs: { agentifui_user_id: actors[0], agentifui_user_role: 'user' },
      response_mode: 'streaming',
      conversation_id: index ? run.thread_id : '',
    });
    expect(call.body).not.toHaveProperty('messages');
    expect(call.body).not.toHaveProperty('history');
  }
  const history = await get(`conversations/${run.conversation_id}`);
  expect(history.statusCode).toBe(200);
  expect(
    history
      .json()
      .messages.map((message: { role: string; content: string }) => [
        message.role,
        message.content,
      ])
  ).toEqual([
    ['user', 'first'],
    ['assistant', 'reply:first'],
    ['user', 'second'],
    ['assistant', 'reply:second'],
  ]);
  expect(next.result.agui.messages).toHaveLength(4);
  expect(next.result.agui.outputMessageIds).toHaveLength(1);
  for (const response of [first, second]) {
    const stream = events(response.body);
    expect(stream[0]).toMatchObject({
      type: 'RUN_STARTED',
      protocolVersion: '1.0',
    });
    expect(stream.at(-1)).toMatchObject({
      type: 'RUN_FINISHED',
      outcome: { type: 'success' },
    });
    for (const event of stream) expect(parseAgentEvent(event)).toBeDefined();
    for (const secret of [
      serviceKey,
      privateMarker,
      run.thread_id,
      run.native_run_id,
    ])
      expect(response.body).not.toContain(secret);
  }
  expect((await get(`runs/${next.id}`)).json()).toMatchObject({
    persistenceStatus: 'saved',
    agui: { runId: next.id, status: 'succeeded' },
  });
  expect(
    (
      await database.query(
        'SELECT used_count FROM group_app_permissions WHERE service_instance_id=$1',
        [apps[0]]
      )
    ).rows[0].used_count
  ).toBe(2);
});

it.each([
  ['replace', 'replacement'],
  ['replace-empty', ''],
])(
  'replaces current output without concatenating or discarding prior history (%s)',
  async (content, expected) => {
    const first = await stored(await submit('previous'));
    const response = await submit(content, {
      conversationId: first.conversation_id,
    });
    const run = await stored(response);
    expect(run.result.messages[0].content).toBe(expected);
    expect(
      run.result.agui.messages.map(
        (message: { content: string }) => message.content
      )
    ).toEqual(['previous', 'reply:previous', content, expected]);
    expect(
      events(response.body).some(event => event.type === 'MESSAGES_SNAPSHOT')
    ).toBe(true);
  }
);

it.each(['advanced-chat', 'agent-chat', 'workflow', null])(
  'refuses unverified native mode %s before generation despite local metadata',
  async nativeMode => {
    mode = nativeMode;
    const response = await submit();
    const run = await stored(response);
    expect(generations()).toHaveLength(0);
    expect(run).toMatchObject({
      execution_status: 'error',
      persistence_status: 'saved',
      task_state: 'rejected',
      error_code: 'DIFY_MODE_UNSUPPORTED',
      thread_id: null,
    });
    expect(events(response.body).at(-1)).toMatchObject({ type: 'RUN_ERROR' });
  }
);

it('requires explicit protocol and rejects client-owned state before registration', async () => {
  expect((await submit('normal', { protocol: null })).statusCode).toBe(409);
  for (const extra of [
    { inputs: {} },
    { user: actors[1] },
    { conversation_id: 'native' },
    { history: [] },
    { profile: 'chatbot' },
  ])
    expect((await submit('forged', { extra })).statusCode).toBe(400);
  expect(calls).toHaveLength(0);
  expect(
    (
      await database.query(
        'SELECT count(*)::int AS count FROM agent_submissions WHERE user_id=ANY($1::uuid[])',
        [actors]
      )
    ).rows[0].count
  ).toBe(0);
});

it('refuses cross-owner, cross-app and old client-declared native bindings without dispatch', async () => {
  const run = await stored(await submit());
  const count = calls.length;
  expect(
    (await submit('stolen', { actor: 1, conversationId: run.conversation_id }))
      .statusCode
  ).toBe(409);
  expect(
    (await submit('wrong app', { app: 1, conversationId: run.conversation_id }))
      .statusCode
  ).toBe(409);
  for (const path of [`runs/${run.id}`, `conversations/${run.conversation_id}`])
    expect((await get(path, 1)).statusCode).toBe(404);
  const legacy = randomUUID();
  await database.query(
    'INSERT INTO conversations(id,user_id,title,app_id,external_id) VALUES($1,$2,$3,$4,$5)',
    [legacy, actors[0], 'legacy', apps[0], run.thread_id]
  );
  expect(
    (await submit('legacy binding', { conversationId: legacy })).statusCode
  ).toBe(409);
  expect(calls).toHaveLength(count);
  expect(
    (await action('messages.getLatest', { conversationId: legacy })).statusCode
  ).toBe(200);
});

it('allows generic history reads but rejects a second browser writer and hides trusted tables under FORCE RLS', async () => {
  const run = await stored(await submit());
  expect(
    (
      await action('messages.getLatest', {
        conversationId: run.conversation_id,
      })
    ).json().data
  ).toHaveLength(2);
  expect(
    (
      await action('messages.save', {
        message: {
          conversation_id: run.conversation_id,
          role: 'assistant',
          content: 'forged',
        },
      })
    ).statusCode
  ).toBe(404);
  expect(
    (
      await action(
        'messages.getLatest',
        { conversationId: run.conversation_id },
        1
      )
    ).statusCode
  ).toBe(404);
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SELECT set_config('app.rls_strict_mode','on',true)");
    expect(
      (await client.query('SELECT * FROM backend_conversations')).rows
    ).toHaveLength(0);
    expect(
      (await client.query('SELECT * FROM backend_runs')).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  await expect(
    database.query(
      'UPDATE backend_conversations SET thread_id=$2 WHERE conversation_id=$1',
      [run.conversation_id, 'mutated']
    )
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await database.query(
        "SELECT column_default FROM information_schema.columns WHERE table_name='backend_conversations' AND column_name='backend_type'"
      )
    ).rows[0].column_default
  ).toContain('langchain');
});

it('deduplicates submissions across replicas and counts quota once without another native request', async () => {
  const submissionId = randomUUID();
  const first = submit('hold-replay', { submissionId });
  await waitFor(() => pending.has('hold-replay'), Boolean);
  const duplicate = await submit('hold-replay', { submissionId, replica: 1 });
  expect(duplicate.statusCode).toBe(409);
  expect(duplicate.json().code).toBe('AGENT_SUBMISSION_REPLAY');
  pending.get('hold-replay')!();
  pending.delete('hold-replay');
  const response = await first;
  const run = await stored(response);
  const again = await submit('hold-replay', { submissionId, replica: 1 });
  expect(again.json().run).toMatchObject({
    runId: run.id,
    persistenceStatus: 'saved',
  });
  expect(generations()).toHaveLength(1);
  expect(
    (
      await database.query(
        'SELECT used_count FROM group_app_permissions WHERE service_instance_id=$1',
        [apps[0]]
      )
    ).rows[0].used_count
  ).toBe(1);
});

it('counts an attached Dify run once and includes unbound legacy Dify admission', async () => {
  const first = submit('hold-capacity');
  await waitFor(() => pending.has('hold-capacity'), Boolean);
  expect((await submit('same user', { app: 1 })).statusCode).toBe(429);
  const second = submit('hold-second', { actor: 1, replica: 1 });
  await waitFor(() => pending.has('hold-second'), Boolean);
  expect((await submit('app full', { actor: 2 })).statusCode).toBe(429);
  pending.get('hold-capacity')!();
  pending.delete('hold-capacity');
  await first;
  const legacy = await registerSubmission({
    userId: actors[0],
    serviceInstanceId: apps[0],
    submissionId: randomUUID(),
    backendType: 'dify',
    targetFingerprint: submissionHash([apps[0], baseUrl, `${marker}-0`]),
    request: { content: 'legacy' },
    credentialVersion: (
      await database.query(
        'SELECT credential_version::text FROM api_keys WHERE service_instance_id=$1',
        [apps[0]]
      )
    ).rows[0].credential_version,
  });
  await submissionStorage(client =>
    admitSubmission(client, legacy.task.root_task_id, actors[0], apps[0], {
      userLimit: 1,
      appLimit: 2,
    })
  );
  expect((await submit('legacy fills app', { actor: 2 })).statusCode).toBe(429);
  pending.get('hold-second')!();
  pending.delete('hold-second');
  await second;
});

it.each([
  'eof',
  'identity-conversation',
  'identity-message',
  'identity-task',
  'legacy-agent',
  'over-budget',
  'unidentified-error',
  'http-500',
  'http-429',
  'malformed-before-empty',
  'malformed-before-string-status',
  'malformed-before-missing-message',
  'malformed-after-empty',
  'malformed-after-string-status',
])(
  'retains unknown without resending or exposing invalid output (%s)',
  async content => {
    const submissionId = randomUUID();
    const response = await submit(content, { submissionId });
    const run = await stored(response);
    expect(run).toMatchObject({
      execution_status: 'unknown',
      persistence_status: 'saved',
      task_state: 'unknown',
    });
    if (content.startsWith('malformed-before'))
      expect(run.quota_state).toBe('reserved');
    expect(events(response.body).at(-1)).toMatchObject({
      type: 'RUN_ERROR',
      code: 'AGENT_STREAM_INCOMPLETE',
    });
    expect(response.body).not.toContain('must-not-display');
    expect(response.body).not.toContain(privateMarker);
    const count = calls.length;
    expect((await get(`runs/${run.id}`)).json()).toMatchObject({
      executionStatus: 'unknown',
    });
    expect(
      (await submit(content, { submissionId, replica: 1 })).statusCode
    ).toBe(409);
    expect(calls).toHaveLength(count);
    expect(generations()).toHaveLength(1);
    expect((await submit('no overlapping retry')).statusCode).toBe(429);
  }
);

it.each(['http-400', 'native-refusal', 'late-error'])(
  'distinguishes known rejection or native failure and never leaks the error body (%s)',
  async content => {
    const response = await submit(content);
    const run = await stored(response);
    expect(run.execution_status).toBe('error');
    expect(run.persistence_status).toBe('saved');
    expect(run.task_state).toBe(
      content === 'late-error' ? 'finished' : 'rejected'
    );
    expect(response.body).not.toContain(privateMarker);
    expect(events(response.body).at(-1)).toMatchObject({
      type: 'RUN_ERROR',
      code: 'AGENT_RUN_FAILED',
    });
    expect(
      (await stored(await submit('after rejection'))).execution_status
    ).toBe('success');
  }
);

it('ignores unknown event identities without using them as native binding evidence', async () => {
  const response = await submit('unknown-first');
  expect((await stored(response)).execution_status).toBe('success');
  expect(response.body).not.toContain('ignored-thread');
});

it('retries only the immutable saved result after message materialization fails', async () => {
  await database.query(
    `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.role='assistant' AND NEW.user_id='${actors[0]}'::uuid THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END; $$`
  );
  await database.query(
    `CREATE TRIGGER ${trigger} BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION ${trigger}()`
  );
  const response = await submit('persist failure');
  const run = await stored(response);
  expect(run).toMatchObject({
    execution_status: 'success',
    persistence_status: 'failed',
  });
  expect(events(response.body).at(-1)).toMatchObject({ type: 'RUN_FINISHED' });
  const count = calls.length;
  await database.query(`DROP TRIGGER ${trigger} ON messages`);
  const restored = await get(`runs/${run.id}`);
  expect(restored.json()).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'saved',
    agui: { status: 'succeeded' },
  });
  expect(
    (await get(`conversations/${run.conversation_id}`)).json().messages
  ).toHaveLength(2);
  expect(calls).toHaveLength(count);
});

it('continues consuming and saving after a real browser socket disconnect', async () => {
  const submissionId = randomUUID();
  const payload = JSON.stringify({ submissionId, content: 'hold-disconnect' });
  await new Promise<void>((resolve, reject) => {
    const request = httpRequest(
      new URL(
        `/api/internal/apps/${apps[0]}/agent/runs`,
        servers[0].listeningOrigin
      ),
      {
        method: 'POST',
        headers: {
          cookie: `session_token=${tokens[0]}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'x-agentifui-protocol': 'ag-ui/1.0',
        },
      },
      response => {
        response.once('data', () => {
          response.destroy();
          resolve();
        });
        response.on('error', () => undefined);
      }
    );
    request.on('error', reject);
    request.end(payload);
  });
  await waitFor(() => pending.has('hold-disconnect'), Boolean);
  pending.get('hold-disconnect')!();
  pending.delete('hold-disconnect');
  const run = await waitFor(
    async () =>
      (
        await database.query(
          'SELECT * FROM backend_runs WHERE submission_id=$1',
          [submissionId]
        )
      ).rows[0],
    value => value?.persistence_status === 'saved'
  );
  expect(run.execution_status).toBe('success');
  expect(
    (await get(`conversations/${run.conversation_id}`)).json().messages
  ).toHaveLength(2);
  expect(generations()).toHaveLength(1);
});

it('requires Dify opt-in only for new conversations and never converts an existing binding back to browser persistence', async () => {
  const first = await stored(await submit('before-disabled'));
  await database.query(
    "UPDATE service_instances SET config=config-'interaction_protocol' WHERE id=$1",
    [apps[0]]
  );
  try {
    const rejected = await submit('not-opted-in');
    expect(rejected.statusCode).toBe(409);
    expect(rejected.body).toContain('AGENT_INTERACTION_NOT_ENABLED');
    const continued = await submit('still-bound', {
      conversationId: first.conversation_id,
    });
    expect((await stored(continued)).execution_status).toBe('success');
    const detail = (await get(`conversations/${first.conversation_id}`)).json();
    expect(detail.protocol).toBe('ag-ui/1.0');
    expect(detail.conversation.interaction_protocol).toBe('ag-ui/1.0');
  } finally {
    await database.query(
      "UPDATE service_instances SET config=jsonb_set(config,'{interaction_protocol}','\"ag-ui/1.0\"') WHERE id=$1",
      [apps[0]]
    );
  }
});

it.each([
  {
    user_input_form: [
      { 'text-input': { required: true, variable: 'custom_required' } },
    ],
  },
  { user_input_form: 'invalid-schema' },
])(
  'refuses unsatisfied native requirements or malformed parameters (%j)',
  async value => {
    parameters = value;
    const response = await submit('unsupported-parameters');
    const run = await stored(response);
    expect(run).toMatchObject({
      execution_status: 'error',
      persistence_status: 'saved',
      error_code: 'DIFY_PARAMETERS_UNSUPPORTED',
    });
    expect(generations()).toHaveLength(0);
  }
);

it('keeps optional native media unavailable in the explicitly selected text-only interaction, without changing the old Dify path', async () => {
  parameters = {
    user_input_form: [],
    file_upload: { enabled: true },
    retriever_resource: { enabled: true },
    speech_to_text: { enabled: true },
    text_to_speech: { enabled: true },
  };
  const descriptor = await servers[0].inject({
    method: 'GET',
    url: `/api/internal/apps/${apps[0]}/agent`,
    headers: { cookie: `session_token=${tokens[0]}` },
  });
  expect(descriptor.json()).toMatchObject({
    interactionMode: 'text-only',
    newConversationsEnabled: true,
    capabilities: { files: false, cancellation: false, humanInput: false },
  });
  expect((await stored(await submit('text-only'))).execution_status).toBe(
    'success'
  );
  expect(generations()[0].body).not.toHaveProperty('files');
});

it('pages trusted history without duplicating messages and derives routing from actual bindings, not metadata', async () => {
  const first = await stored(await submit('page-first'));
  await submit('page-second', { conversationId: first.conversation_id });
  const latest = (
    await get(`conversations/${first.conversation_id}?limit=2`)
  ).json();
  expect(
    latest.messages.map((message: { content: string }) => message.content)
  ).toEqual(['page-second', 'reply:page-second']);
  expect(latest.nextCursor).toBe('2');
  const older = (
    await get(
      `conversations/${first.conversation_id}?limit=2&before=${latest.nextCursor}`
    )
  ).json();
  expect(
    older.messages.map((message: { content: string }) => message.content)
  ).toEqual(['page-first', 'reply:page-first']);
  expect(older.nextCursor).toBeNull();
  expect(
    (await get(`conversations/${first.conversation_id}?before=not-a-cursor`))
      .statusCode
  ).toBe(400);
  const listed = await action('conversations.getUserConversations', {});
  expect(listed.body).toContain('"interaction_protocol":"ag-ui/1.0"');
  const lookedUp = await action('conversations.getConversationByExternalId', {
    externalId: first.conversation_id,
  });
  expect(lookedUp.body).toContain('"interaction_protocol":"ag-ui/1.0"');
});
