/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';

import type { ApiRuntimeConfig } from '../../apps/api/src/config';
import { resolveAgentApp } from '../../apps/api/src/lib/agent-app';
import { moderateInputText } from '../../apps/api/src/lib/agent-input-moderation';
import {
  getInteractionForActor,
  getInteractionResponseReplay,
  markResumeSubmitting,
  releaseUndispatchedResume,
  reserveInteractionResponse,
} from '../../apps/api/src/lib/agent-interactions-repository';
import { markSubmissionSubmitting } from '../../apps/api/src/lib/agent-submissions';
import { getPgPool } from '../../apps/api/src/lib/pg-context';
import { createApiServer } from '../../apps/api/src/server';
import { resolveTestDatabaseUrl } from './helpers/test-database-url';
import { createTestRole, dropTestRole } from './helpers/test-role';

jest.mock('../../apps/api/src/lib/error-events', () => ({
  recordApiErrorEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../apps/api/src/lib/agent-input-moderation', () => ({
  moderateInputText: jest.fn(),
}));
jest.mock('../../apps/api/src/lib/agent-interactions-repository', () => {
  const actual = jest.requireActual(
    '../../apps/api/src/lib/agent-interactions-repository'
  );
  return {
    ...actual,
    getInteractionResponseReplay: jest.fn(actual.getInteractionResponseReplay),
  };
});
jest.mock('../../apps/api/src/lib/agent-submissions', () => {
  const actual = jest.requireActual('../../apps/api/src/lib/agent-submissions');
  return {
    ...actual,
    markSubmissionSubmitting: jest.fn(actual.markSubmissionSubmitting),
  };
});
jest.setTimeout(30000);

const environment = { ...process.env };
const originalFetch = global.fetch;
const actors = [randomUUID(), randomUUID()];
const tokens = actors.map(() => randomUUID());
const provider = randomUUID();
const application = randomUUID();
const group = randomUUID();
const permission = randomUUID();
const marker = `human-input-${randomUUID()}`;
const role = `hitl_${randomUUID().replaceAll('-', '')}`;
const assistant = 'config-selected-confirmation';
const secret = 'synthetic-private-service-key';
const privateMarker = 'synthetic-private-native-state';
const servers: Awaited<ReturnType<typeof createApiServer>>[] = [];
const calls: { method: string; path: string; body: Record<string, unknown> }[] =
  [];
interface Thread {
  interruptId: string;
  checkpoint: string;
  outcome: 'pending' | 'approved' | 'rejected';
  decision?: { action: string; comment: string };
  effects: number;
  runs: Map<
    string,
    { run_id: string; thread_id: string; status: string; metadata: unknown }
  >;
}
const threads = new Map<string, Thread>();
let loseResumeResponse = false;
let holdResume = false;
let expireAt: string | null = null;
let resumeNativeError = false;
let initialNativeError = false;
let failNativeReads = false;
let capabilitiesGate: { entered: () => void; wait: Promise<void> } | undefined;
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

function endpoint(suffix: string) {
  return `/api/internal/apps/${application}/agent${suffix}`;
}
function request(suffix: string, actor = 0, server = 0) {
  return servers[server].inject({
    method: 'GET',
    url: endpoint(suffix),
    headers: { cookie: `session_token=${tokens[actor]}` },
  });
}
function respond(
  id: string,
  payload: Record<string, unknown>,
  actor = 0,
  server = 0
) {
  return servers[server].inject({
    method: 'POST',
    url: endpoint(`/interactions/${id}/respond`),
    headers: { cookie: `session_token=${tokens[actor]}` },
    payload,
  });
}
async function eventually<Result>(
  operation: () => Promise<Result>,
  accept: (value: Result) => boolean
): Promise<Result> {
  const deadline = Date.now() + 8000;
  while (true) {
    const result = await operation();
    if (accept(result)) return result;
    if (Date.now() >= deadline)
      throw new Error('Synthetic HITL condition timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function start() {
  const response = await servers[0].inject({
    method: 'POST',
    url: endpoint('/runs'),
    headers: {
      cookie: `session_token=${tokens[0]}`,
      'x-agentifui-protocol': 'ag-ui/1.0',
    },
    payload: {
      submissionId: randomUUID(),
      content: 'Prepare a synthetic report.',
    },
  });
  expect(response.statusCode).toBe(200);
  const events = response.body
    .split(/\r?\n/)
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)));
  const started = events.find(event => event.type === 'RUN_STARTED');
  expect(started).toBeDefined();
  const terminal = events.find(event => event.type === 'RUN_FINISHED');
  expect(terminal?.outcome.type).toBe('interrupt');
  const listed = await request(
    `/conversations/${started.threadId}/interactions`
  );
  expect(listed.statusCode).toBe(200);
  return {
    runId: started.runId as string,
    conversationId: started.threadId as string,
    interaction: listed.json().interactions[0] as {
      id: string;
      status: string;
    },
    events,
  };
}
async function stored(runId: string) {
  return (
    await database.query('SELECT * FROM backend_runs WHERE id=$1', [runId])
  ).rows[0];
}
async function finish(runId: string) {
  await eventually(
    () => stored(runId),
    run => run.execution_status !== 'reserved'
  );
  return eventually(
    async () => {
      await request(`/runs/${runId}`);
      return stored(runId);
    },
    run =>
      run.execution_status === 'success' && run.persistence_status === 'saved'
  );
}

function holdPreparation() {
  let entered: () => void = () => undefined;
  let release: () => void = () => undefined;
  const ready = new Promise<void>(resolve => {
    entered = resolve;
  });
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  capabilitiesGate = { entered, wait };
  return { ready, release };
}

async function reservePrepared(
  task: Awaited<ReturnType<typeof start>>,
  response = {
    submissionId: randomUUID(),
    action: 'approve' as const,
    comment: '',
  }
) {
  const app = await resolveAgentApp(application, actors[0]);
  return {
    app,
    ...(await reserveInteractionResponse({
      app,
      userId: actors[0],
      interactionId: task.interaction.id,
      response,
      userLimit: 1,
      appLimit: 2,
    })),
  };
}

function resumePosts() {
  return calls.filter(
    call =>
      call.method === 'POST' &&
      call.path.endsWith('/runs/stream') &&
      call.body.command
  );
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
    incoming.on('end', async () => {
      const path = incoming.url || '';
      const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
      calls.push({ method: incoming.method || '', path, body });
      response.setHeader('content-type', 'application/json');
      if (incoming.headers.authorization !== `Bearer ${secret}`) {
        response.writeHead(401).end('{}');
        return;
      }
      if (path === '/capabilities') {
        const gate = capabilitiesGate;
        capabilitiesGate = undefined;
        if (gate) {
          gate.entered();
          await gate.wait;
        }
        if (failNativeReads) {
          response.writeHead(503).end('{}');
          return;
        }
        response.end(
          JSON.stringify({
            agents: [
              {
                assistant_id: assistant,
                features: ['native_interrupt', 'native_resume'],
                actions: ['approve', 'reject'],
                one_task_per_thread: true,
              },
            ],
          })
        );
        return;
      }
      if (path === '/threads' && incoming.method === 'POST') {
        const threadId = randomUUID();
        threads.set(threadId, {
          interruptId: randomUUID(),
          checkpoint: randomUUID(),
          outcome: 'pending',
          effects: 0,
          runs: new Map(),
        });
        response.end(JSON.stringify({ thread_id: threadId }));
        return;
      }
      const match = /^\/threads\/([^/]+)\/(.+)$/.exec(path);
      const thread = match && threads.get(match[1]);
      if (!match || !thread) {
        response.writeHead(404).end('{}');
        return;
      }
      const [, threadId, resource] = match;
      if (resource === 'state') {
        if (failNativeReads) {
          response.writeHead(503).end('{}');
          return;
        }
        const pending = thread.outcome === 'pending' && !initialNativeError;
        response.end(
          JSON.stringify({
            next: pending ? ['await_decision'] : [],
            checkpoint: {
              checkpoint_id: thread.checkpoint,
              thread_id: threadId,
            },
            tasks: pending
              ? [
                  {
                    interrupts: [
                      {
                        id: thread.interruptId,
                        value: {
                          kind: 'agentifui.acceptance.confirmation',
                          version: 1,
                          task_id: privateMarker,
                          title: 'Confirm synthetic report',
                          description: 'No external effects.',
                          actions: ['approve', 'reject'],
                          comment_max_length: 500,
                          expires_at: expireAt,
                          private_field: privateMarker,
                        },
                      },
                    ],
                  },
                ]
              : [],
            values: {
              outcome: thread.outcome,
              decision: thread.decision,
              effect_count: thread.effects,
              private_field: privateMarker,
              messages: pending
                ? []
                : [
                    {
                      type: 'ai',
                      id: `native-final-${threadId}`,
                      content:
                        thread.outcome === 'approved'
                          ? 'Approved synthetic report.'
                          : 'Rejected, no operation.',
                    },
                  ],
            },
          })
        );
        return;
      }
      if (resource.startsWith('runs?')) {
        response.end(JSON.stringify([...thread.runs.values()]));
        return;
      }
      if (resource.startsWith('runs/') && resource !== 'runs/stream') {
        const run = thread.runs.get(resource.slice(5));
        response.writeHead(run ? 200 : 404).end(JSON.stringify(run || {}));
        return;
      }
      if (resource === 'runs/stream' && incoming.method === 'POST') {
        const runId = randomUUID();
        const resume = body.command !== undefined;
        const run = {
          thread_id: threadId,
          run_id: runId,
          status:
            (!resume && initialNativeError) || (resume && resumeNativeError)
              ? 'error'
              : resume && holdResume
                ? 'running'
                : 'success',
          metadata: body.metadata,
        };
        thread.runs.set(runId, run);
        if (resume && !holdResume && !resumeNativeError) {
          const command = body.command as {
            resume: Record<string, { action: string; comment: string }>;
          };
          thread.decision = command.resume[thread.interruptId];
          thread.outcome =
            thread.decision.action === 'approve' ? 'approved' : 'rejected';
          thread.effects = thread.outcome === 'approved' ? 1 : 0;
        }
        if (resume && loseResumeResponse) {
          response.destroy();
          return;
        }
        response.setHeader('content-type', 'text/event-stream');
        response.end(
          `event: metadata\ndata: ${JSON.stringify({ run_id: runId })}\n\nevent: updates\ndata: {}\n\n`
        );
        return;
      }
      response.writeHead(404).end('{}');
    });
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  await createTestRole(database, role);
  for (const [index, actor] of actors.entries()) {
    await database.query(
      'INSERT INTO auth_users(id,name,email) VALUES($1,$2,$3)',
      [actor, marker, `${actor}@example.invalid`]
    );
    await database.query(
      "INSERT INTO profiles(id,email,role,status) VALUES($1,$2,'user','active')",
      [actor, `${actor}@example.invalid`]
    );
    await database.query(
      "INSERT INTO auth_sessions(user_id,token,expires_at) VALUES($1,$2,NOW()+interval '1 hour')",
      [actor, tokens[index]]
    );
  }
  await database.query(
    "INSERT INTO providers(id,name,type,base_url,auth_type) VALUES($1,$2,'dify',$3,'bearer')",
    [
      provider,
      marker,
      `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    ]
  );
  await database.query(
    "INSERT INTO service_instances(id,provider_id,instance_id,visibility,config) VALUES($1,$2,$3,'group_only',$4)",
    [
      application,
      provider,
      marker,
      {
        backend_type: 'langchain',
        langchain: { assistant_id: assistant, human_input: true },
      },
    ]
  );
  await database.query(
    'INSERT INTO api_keys(provider_id,service_instance_id,key_value,is_default) VALUES($1,$2,$3,TRUE)',
    [provider, application, secret]
  );
  await database.query('INSERT INTO groups(id,name) VALUES($1,$2)', [
    group,
    marker,
  ]);
  await database.query(
    'INSERT INTO group_app_permissions(id,group_id,service_instance_id,usage_quota) VALUES($1,$2,$3,1)',
    [permission, group, application]
  );
  for (const actor of actors)
    await database.query(
      'INSERT INTO group_members(group_id,user_id) VALUES($1,$2)',
      [group, actor]
    );
  const scoped = new URL(resolveTestDatabaseUrl());
  scoped.searchParams.set(
    'options',
    `-c role=${role} -c app.rls_strict_mode=on`
  );
  process.env.DATABASE_URL = scoped.toString();
  process.env.APP_RLS_STRICT_MODE = 'true';
  process.env.AGENT_MAX_ACTIVE_PER_USER = '1';
  process.env.AGENT_MAX_ACTIVE_PER_APP = '2';
  for (let count = 0; count < 2; count++) {
    const server = await createApiServer(config);
    await server.ready();
    servers.push(server);
  }
});

beforeEach(async () => {
  jest
    .mocked(markSubmissionSubmitting)
    .mockReset()
    .mockImplementation(
      jest.requireActual('../../apps/api/src/lib/agent-submissions')
        .markSubmissionSubmitting
    );
  jest
    .mocked(getInteractionResponseReplay)
    .mockReset()
    .mockImplementation(
      jest.requireActual('../../apps/api/src/lib/agent-interactions-repository')
        .getInteractionResponseReplay
    );
  calls.length = 0;
  loseResumeResponse = false;
  holdResume = false;
  expireAt = null;
  resumeNativeError = false;
  initialNativeError = false;
  failNativeReads = false;
  capabilitiesGate = undefined;
  jest
    .mocked(moderateInputText)
    .mockResolvedValue({ outcome: 'allow' } as Awaited<
      ReturnType<typeof moderateInputText>
    >);
  await database.query(
    'UPDATE group_app_permissions SET used_count=0,usage_quota=1,is_enabled=TRUE WHERE id=$1',
    [permission]
  );
  await database.query(
    'INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [group, actors[0]]
  );
});

it('keeps first-turn quota and concurrency reserved after a persisted dispatch claim loses its acknowledgment', async () => {
  const actual = jest.requireActual<
    typeof import('../../apps/api/src/lib/agent-submissions')
  >('../../apps/api/src/lib/agent-submissions');
  jest.mocked(markSubmissionSubmitting).mockImplementationOnce(async taskId => {
    await actual.markSubmissionSubmitting(taskId);
    throw new Error('synthetic lost COMMIT acknowledgment');
  });
  const response = await servers[0].inject({
    method: 'POST',
    url: endpoint('/runs'),
    headers: {
      cookie: `session_token=${tokens[0]}`,
      'x-agentifui-protocol': 'ag-ui/1.0',
    },
    payload: {
      submissionId: randomUUID(),
      content: 'Synthetic first-turn claim.',
    },
  });
  expect(response.statusCode).toBe(200);
  const rows = await database.query(
    'SELECT * FROM backend_runs WHERE user_id=$1',
    [actors[0]]
  );
  expect(rows.rows).toHaveLength(1);
  const run = rows.rows[0];
  for (let attempt = 0; attempt < 2; attempt++) {
    expect((await request(`/runs/${run.id}`)).statusCode).toBe(200);
    expect(await stored(run.id)).toMatchObject({
      execution_status: 'unknown',
      persistence_status: 'pending',
      result: null,
    });
    expect(
      (
        await database.query(
          'SELECT state,quota_state FROM agent_submissions WHERE run_id=$1',
          [run.id]
        )
      ).rows[0]
    ).toMatchObject({ state: 'unknown', quota_state: 'reserved' });
    expect(
      (
        await database.query(
          'SELECT used_count FROM group_app_permissions WHERE id=$1',
          [permission]
        )
      ).rows[0].used_count
    ).toBe(0);
  }
  const next = await servers[0].inject({
    method: 'POST',
    url: endpoint('/runs'),
    headers: {
      cookie: `session_token=${tokens[0]}`,
      'x-agentifui-protocol': 'ag-ui/1.0',
    },
    payload: {
      submissionId: randomUUID(),
      content: 'Must not bypass unknown occupancy.',
    },
  });
  expect(next.statusCode).toBe(429);
  expect(
    calls.filter(
      call => call.method === 'POST' && call.path.endsWith('/runs/stream')
    )
  ).toHaveLength(0);
});

afterEach(async () => {
  for (const server of servers)
    await server.inject({ method: 'GET', url: '/health' });
  await database.query(
    `UPDATE backend_runs SET execution_status = CASE WHEN execution_status = 'waiting' THEN 'waiting' ELSE 'error' END,
    persistence_status='saved' WHERE user_id=ANY($1::uuid[])`,
    [actors]
  );
  const pending = await database.query(
    `SELECT interaction.*, origin.conversation_id, origin.user_id, origin.service_instance_id, origin.root_run_id
    FROM backend_run_interactions interaction JOIN backend_runs origin ON origin.id=interaction.origin_run_id
    WHERE origin.user_id=ANY($1::uuid[]) AND interaction.status <> 'accepted'`,
    [actors]
  );
  for (const interaction of pending.rows) {
    const resumeId = interaction.resume_run_id || randomUUID();
    if (!interaction.resume_run_id)
      await database.query(
        `INSERT INTO backend_runs(id,conversation_id,user_id,service_instance_id,
      submission_id,request_hash,run_kind,root_run_id,sequence_anchor,execution_status,persistence_status)
      VALUES($1,$2,$3,$4,$5,$6,'resume',$7,0,'error','saved')`,
        [
          resumeId,
          interaction.conversation_id,
          interaction.user_id,
          interaction.service_instance_id,
          randomUUID(),
          '0'.repeat(64),
          interaction.root_run_id,
        ]
      );
    await database.query(
      `UPDATE backend_run_interactions SET status='accepted', submission_id=COALESCE(submission_id,$2::uuid),
      request_hash=COALESCE(request_hash,$3),decision=COALESCE(decision,'{"action":"reject","comment":"synthetic cleanup"}'::jsonb),
      resume_run_id=COALESCE(resume_run_id,$4::uuid) WHERE id=$1`,
      [interaction.id, randomUUID(), '0'.repeat(64), resumeId]
    );
  }
  await database.query(
    "UPDATE agent_submissions SET state='finished',quota_state=CASE WHEN quota_state='reserved' THEN 'released' ELSE quota_state END WHERE user_id=ANY($1::uuid[])",
    [actors]
  );
  await database.query(
    'DELETE FROM conversations WHERE user_id=ANY($1::uuid[])',
    [actors]
  );
  await database.query(
    'DELETE FROM agent_submissions WHERE user_id=ANY($1::uuid[])',
    [actors]
  );
});

afterAll(async () => {
  for (const server of servers) await server.close();
  if (upstream)
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  global.fetch = originalFetch;
  const state = globalThis as Record<string, unknown>;
  if (state.__agentifui_fastify_pg_pool__) await getPgPool().end();
  delete state.__agentifui_fastify_pg_pool__;
  delete state.__agentifui_fastify_session_resolver_cache__;
  if (database) {
    await database.query('DELETE FROM groups WHERE id=$1', [group]);
    await database.query('DELETE FROM providers WHERE id=$1', [provider]);
    await database.query('DELETE FROM profiles WHERE id=ANY($1::uuid[])', [
      actors,
    ]);
    await database.query('DELETE FROM auth_users WHERE id=ANY($1::uuid[])', [
      actors,
    ]);
    await dropTestRole(database, role);
    await database.end();
  }
  for (const key of [
    'DATABASE_URL',
    'APP_RLS_STRICT_MODE',
    'AGENT_MAX_ACTIVE_PER_USER',
    'AGENT_MAX_ACTIVE_PER_APP',
  ]) {
    if (environment[key] === undefined) delete process.env[key];
    else process.env[key] = environment[key];
  }
});

it('describes explicit HITL and treats native success with task interrupts as waiting, without leaking native state', async () => {
  const descriptor = await request('');
  expect(descriptor.json()).toMatchObject({
    capabilities: { humanInput: true },
    singleTask: true,
  });
  const task = await start();
  expect(await stored(task.runId)).toMatchObject({
    run_kind: 'turn',
    root_run_id: task.runId,
    execution_status: 'waiting',
    persistence_status: 'saved',
  });
  const native = [...threads.values()].at(-1)!;
  const serialized =
    JSON.stringify(task.events) +
    (await request(`/conversations/${task.conversationId}/interactions`)).body;
  for (const forbidden of [
    secret,
    privateMarker,
    native.interruptId,
    native.checkpoint,
    [...native.runs.keys()][0],
  ])
    expect(serialized).not.toContain(forbidden);
  expect(
    (
      await database.query(
        'SELECT used_count FROM group_app_permissions WHERE id=$1',
        [permission]
      )
    ).rows[0].used_count
  ).toBe(1);
});

it.each(['approve', 'reject'])(
  'resumes %s with no fake user message, no extra question quota and a persisted standard projection',
  async action => {
    const task = await start();
    const response = await respond(task.interaction.id, {
      submissionId: randomUUID(),
      action,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      run: { runKind: 'resume', rootRunId: task.runId },
      replayed: false,
    });
    const run = await finish(response.json().run.id);
    expect(run.user_message_id).toBeNull();
    expect(run.result.agui.status).toBe('succeeded');
    expect(
      (
        await database.query(
          'SELECT role::text,sequence_index FROM messages WHERE conversation_id=$1 ORDER BY sequence_index',
          [task.conversationId]
        )
      ).rows
    ).toEqual([
      { role: 'user', sequence_index: 0 },
      { role: 'assistant', sequence_index: 1 },
    ]);
    const history = await request(`/conversations/${task.conversationId}`);
    expect(history.json().runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: run.id, runKind: 'resume' }),
      ])
    );
    expect(
      (
        await request(`/conversations/${task.conversationId}/interactions`)
      ).json().interactions[0]
    ).toMatchObject({
      status: 'accepted',
      decision: { action, comment: '' },
      resumeRunId: run.id,
    });
    const native = calls.filter(
      call => call.path.endsWith('/runs/stream') && call.body.command
    );
    expect(native).toHaveLength(1);
    expect(native[0].body).not.toHaveProperty('input');
    expect(
      (
        await database.query(
          'SELECT used_count FROM group_app_permissions WHERE id=$1',
          [permission]
        )
      ).rows[0].used_count
    ).toBe(1);
  }
);

it('allows one winner across API instances, replays the same answer without a dispatch and rejects changed content', async () => {
  const task = await start();
  const first = { submissionId: randomUUID(), action: 'approve' };
  const responses = await Promise.all([
    respond(task.interaction.id, first),
    respond(
      task.interaction.id,
      { submissionId: randomUUID(), action: 'reject' },
      0,
      1
    ),
  ]);
  expect(responses.map(response => response.statusCode).sort()).toEqual([
    202, 409,
  ]);
  const winner = responses.find(response => response.statusCode === 202)!;
  const run = await finish(winner.json().run.id);
  const interaction = (
    await request(`/conversations/${task.conversationId}/interactions`)
  ).json().interactions[0];
  const storedInteraction = (
    await database.query('SELECT * FROM backend_run_interactions WHERE id=$1', [
      interaction.id,
    ])
  ).rows[0];
  const replay = await respond(
    interaction.id,
    {
      submissionId: storedInteraction.submission_id,
      ...storedInteraction.decision,
    },
    0,
    1
  );
  expect(replay.statusCode).toBe(202);
  expect(replay.json()).toMatchObject({ run: { id: run.id }, replayed: true });
  expect(
    (
      await respond(interaction.id, {
        submissionId: storedInteraction.submission_id,
        action: storedInteraction.decision.action,
        comment: 'changed',
      })
    ).statusCode
  ).toBe(409);
  expect(
    calls.filter(
      call => call.path.endsWith('/runs/stream') && call.body.command
    )
  ).toHaveLength(1);
});

it('reconciles a lost creation response by native run metadata and state without resending', async () => {
  const task = await start();
  loseResumeResponse = true;
  const response = await respond(task.interaction.id, {
    submissionId: randomUUID(),
    action: 'approve',
  });
  expect(response.statusCode).toBe(202);
  await eventually(
    async () => stored(response.json().run.id),
    run => run.execution_status === 'unknown'
  );
  const before = calls.filter(call => call.method === 'POST').length;
  const run = await finish(response.json().run.id);
  expect(run.native_run_id).toBeTruthy();
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(before);
  expect(
    (await request(`/conversations/${task.conversationId}/interactions`)).json()
      .interactions[0].status
  ).toBe('accepted');
});

it('keeps unknown capacity and never retries an unresolved answer, even with an old timestamp', async () => {
  const task = await start();
  holdResume = true;
  loseResumeResponse = true;
  const answer = { submissionId: randomUUID(), action: 'reject' };
  const response = await respond(task.interaction.id, answer);
  await eventually(
    async () => stored(response.json().run.id),
    run => run.execution_status === 'unknown'
  );
  await database.query(
    "UPDATE backend_runs SET updated_at=NOW()-interval '1 day' WHERE id=$1",
    [response.json().run.id]
  );
  const postCount = calls.filter(call => call.method === 'POST').length;
  const queried = await request(
    `/conversations/${task.conversationId}/interactions`
  );
  expect(['submitting', 'unknown']).toContain(
    queried.json().interactions[0].status
  );
  expect((await respond(task.interaction.id, answer)).json().replayed).toBe(
    true
  );
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(postCount);
  expect(['running', 'unknown']).toContain(
    (await stored(response.json().run.id)).execution_status
  );
});

it.each([
  ['block', 400, 'CONTENT_MODERATION_BLOCKED'],
  ['unavailable', 503, 'CONTENT_MODERATION_UNAVAILABLE'],
] as const)(
  'audits a new answer after a stale claimed read and a real release (%s)',
  async (outcome, status, code) => {
    const task = await start();
    const prepared = await reservePrepared(task);
    const newSubmission = randomUUID();
    const quotaBefore = (
      await database.query(
        'SELECT used_count FROM group_app_permissions WHERE id=$1',
        [permission]
      )
    ).rows[0].used_count;
    const originalReplay = jest.requireActual(
      '../../apps/api/src/lib/agent-interactions-repository'
    ).getInteractionResponseReplay as typeof getInteractionResponseReplay;
    jest
      .mocked(getInteractionResponseReplay)
      .mockImplementationOnce(async input => {
        expect(input.response.submissionId).toBe(newSubmission);
        expect(await originalReplay(input)).toBeNull();
        expect(await releaseUndispatchedResume(prepared.run.id)).toBe(true);
        return null;
      });
    jest
      .mocked(moderateInputText)
      .mockClear()
      .mockResolvedValue({ outcome } as Awaited<
        ReturnType<typeof moderateInputText>
      >);
    const response = await respond(
      task.interaction.id,
      {
        submissionId: newSubmission,
        action: 'approve',
        comment: 'New comment from the competing response',
      },
      0,
      1
    );
    expect(response.statusCode).toBe(status);
    expect(response.json().app_error.code).toBe(code);
    expect(moderateInputText).toHaveBeenCalledTimes(1);
    expect(moderateInputText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'New comment from the competing response',
      })
    );
    expect(resumePosts()).toHaveLength(0);
    expect(
      (
        await database.query(
          'SELECT id FROM backend_runs WHERE submission_id=$1',
          [newSubmission]
        )
      ).rows
    ).toHaveLength(0);
    const interaction = await getInteractionForActor(
      prepared.app,
      actors[0],
      task.interaction.id
    );
    expect(interaction).toMatchObject({
      status: 'pending',
      submission_id: null,
      request_hash: null,
      decision: null,
      resume_run_id: null,
    });
    expect(
      (
        await database.query(
          'SELECT used_count FROM group_app_permissions WHERE id=$1',
          [permission]
        )
      ).rows[0].used_count
    ).toBe(quotaBefore);
  }
);

it('rejects other users, invalid schemas and blocked comments before consuming the pending item', async () => {
  const task = await start();
  expect(
    (
      await respond(
        task.interaction.id,
        { submissionId: randomUUID(), action: 'approve' },
        1
      )
    ).statusCode
  ).toBe(404);
  for (const fields of [
    { action: 'other' },
    { action: 'approve', checkpoint: 'injected' },
    { action: 'approve', comment: 'x'.repeat(501) },
  ])
    expect(
      (
        await respond(task.interaction.id, {
          submissionId: randomUUID(),
          ...fields,
        })
      ).statusCode
    ).toBe(400);
  jest
    .mocked(moderateInputText)
    .mockResolvedValue({ outcome: 'block' } as Awaited<
      ReturnType<typeof moderateInputText>
    >);
  expect(
    (
      await respond(task.interaction.id, {
        submissionId: randomUUID(),
        action: 'approve',
        comment: 'blocked',
      })
    ).statusCode
  ).toBe(400);
  expect(
    (await request(`/conversations/${task.conversationId}/interactions`)).json()
      .interactions[0].status
  ).toBe('pending');
  expect(
    calls.filter(
      call => call.path.endsWith('/runs/stream') && call.body.command
    )
  ).toHaveLength(0);
});

it('requires the original group membership even when a different group now grants application access', async () => {
  const task = await start();
  const alternateGroup = randomUUID();
  await database.query('INSERT INTO groups(id,name) VALUES($1,$2)', [
    alternateGroup,
    `${marker}-alternate`,
  ]);
  try {
    await database.query(
      'INSERT INTO group_app_permissions(group_id,service_instance_id) VALUES($1,$2)',
      [alternateGroup, application]
    );
    await database.query(
      'INSERT INTO group_members(group_id,user_id) VALUES($1,$2)',
      [alternateGroup, actors[0]]
    );
    await database.query(
      'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2',
      [group, actors[0]]
    );
    expect(
      (
        await respond(task.interaction.id, {
          submissionId: randomUUID(),
          action: 'reject',
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await request(`/conversations/${task.conversationId}/interactions`)
      ).json().interactions[0].status
    ).toBe('pending');
  } finally {
    await database.query('DELETE FROM groups WHERE id=$1', [alternateGroup]);
  }
});

it('rechecks shared Dify computation slots but not an exhausted question quota for a resume', async () => {
  const task = await start();
  const otherApp = randomUUID();
  const otherRoot = randomUUID();
  await database.query(
    "INSERT INTO service_instances(id,provider_id,instance_id,visibility,config) VALUES($1,$2,$3,'public','{}')",
    [otherApp, provider, `${marker}-dify`]
  );
  try {
    await database.query(
      `INSERT INTO agent_submissions(root_task_id,user_id,service_instance_id,submission_id,request_hash,target_fingerprint,backend_type,state,quota_state)
      VALUES($1,$2,$3,$4,$5,$5,'dify','unknown','exempt')`,
      [otherRoot, actors[0], otherApp, randomUUID(), '0'.repeat(64)]
    );
    expect(
      (
        await respond(task.interaction.id, {
          submissionId: randomUUID(),
          action: 'approve',
        })
      ).statusCode
    ).toBe(429);
    expect(
      (
        await request(`/conversations/${task.conversationId}/interactions`)
      ).json().interactions[0].status
    ).toBe('pending');
    await database.query(
      "UPDATE agent_submissions SET state='finished' WHERE root_task_id=$1",
      [otherRoot]
    );
    const accepted = await respond(task.interaction.id, {
      submissionId: randomUUID(),
      action: 'reject',
    });
    expect(accepted.statusCode).toBe(202);
    await finish(accepted.json().run.id);
  } finally {
    await database.query(
      "UPDATE agent_submissions SET state='finished' WHERE root_task_id=$1",
      [otherRoot]
    );
    await database.query('DELETE FROM service_instances WHERE id=$1', [
      otherApp,
    ]);
  }
});

it('protects pending deletion, target edits, credential replacement and quota identity while permitting revocation', async () => {
  const task = await start();
  for (const [sql, params] of [
    ['DELETE FROM conversations WHERE id=$1', [task.conversationId]],
    [
      "UPDATE conversations SET status='deleted' WHERE id=$1",
      [task.conversationId],
    ],
    ['DELETE FROM profiles WHERE id=$1', [actors[0]]],
    ['DELETE FROM backend_runs WHERE id=$1', [task.runId]],
    ['DELETE FROM backend_run_interactions WHERE id=$1', [task.interaction.id]],
    [
      "UPDATE providers SET base_url='https://changed.example.invalid' WHERE id=$1",
      [provider],
    ],
    [
      "UPDATE service_instances SET config=jsonb_set(config,'{langchain,assistant_id}','\"changed\"') WHERE id=$1",
      [application],
    ],
    [
      "UPDATE api_keys SET key_value='replacement' WHERE service_instance_id=$1",
      [application],
    ],
    ['DELETE FROM group_app_permissions WHERE id=$1', [permission]],
    ['UPDATE group_app_permissions SET used_count=0 WHERE id=$1', [permission]],
  ] as [string, string[]][])
    await expect(database.query(sql, params)).rejects.toMatchObject({
      code: '23514',
    });
  await database.query(
    'UPDATE group_app_permissions SET is_enabled=FALSE WHERE id=$1',
    [permission]
  );
  expect(
    (
      await respond(task.interaction.id, {
        submissionId: randomUUID(),
        action: 'reject',
      })
    ).statusCode
  ).toBe(404);
  expect(
    (
      await database.query(
        'SELECT status FROM backend_run_interactions WHERE id=$1',
        [task.interaction.id]
      )
    ).rows[0].status
  ).toBe('pending');
});

it('uses FORCE RLS and hides native interaction rows from a non-system application role', async () => {
  await start();
  expect(
    (await getPgPool().query('SELECT * FROM backend_run_interactions')).rows
  ).toHaveLength(0);
  expect(
    (
      await getPgPool().query(
        'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user'
      )
    ).rows[0]
  ).toEqual({ rolsuper: false, rolbypassrls: false });
  expect(
    (
      await database.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='backend_run_interactions'::regclass"
      )
    ).rows[0]
  ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
});

it('keeps a single-task thread closed to new ordinary questions even after completion', async () => {
  const task = await start();
  const answer = await respond(task.interaction.id, {
    submissionId: randomUUID(),
    action: 'reject',
  });
  await finish(answer.json().run.id);
  const response = await servers[0].inject({
    method: 'POST',
    url: endpoint('/runs'),
    headers: { cookie: `session_token=${tokens[0]}` },
    payload: {
      submissionId: randomUUID(),
      conversationId: task.conversationId,
      content: 'A different task.',
    },
  });
  expect(response.statusCode).toBe(409);
  expect(response.body).toContain('AGENT_SINGLE_TASK_CONVERSATION');
});

it('rejects expired pending answers without dispatching a resume', async () => {
  expireAt = new Date(Date.now() - 60000).toISOString();
  const task = await start();
  expect(task.interaction.status).toBe('expired');
  expect(
    (
      await respond(task.interaction.id, {
        submissionId: randomUUID(),
        action: 'approve',
      })
    ).statusCode
  ).toBe(409);
  expect(
    calls.filter(
      call => call.path.endsWith('/runs/stream') && call.body.command
    )
  ).toHaveLength(0);
});

it('never labels a native error as an accepted human decision and never POSTs during subsequent queries', async () => {
  const task = await start();
  resumeNativeError = true;
  const response = await respond(task.interaction.id, {
    submissionId: randomUUID(),
    action: 'approve',
  });
  expect(response.statusCode).toBe(202);
  await eventually(
    async () => stored(response.json().run.id),
    run => run.execution_status === 'unknown'
  );
  const count = calls.filter(call => call.method === 'POST').length;
  const listed = await request(
    `/conversations/${task.conversationId}/interactions`
  );
  expect(listed.json().interactions[0].status).toBe('unknown');
  await request(`/runs/${response.json().run.id}`);
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(count);
});

it('replays simultaneous identical submissions across API instances into a single native resume', async () => {
  const task = await start();
  const answer = {
    submissionId: randomUUID(),
    action: 'reject',
    comment: 'One decision.',
  };
  const responses = await Promise.all([
    respond(task.interaction.id, answer),
    respond(task.interaction.id, answer, 0, 1),
  ]);
  expect(responses.map(response => response.statusCode)).toEqual([202, 202]);
  expect(responses[0].json().run.id).toBe(responses[1].json().run.id);
  await finish(responses[0].json().run.id);
  expect(
    calls.filter(
      call => call.path.endsWith('/runs/stream') && call.body.command
    )
  ).toHaveLength(1);
});

it('keeps turn user messages mandatory and rejects a resume with an unrelated root', async () => {
  const task = await start();
  for (const [kind, rootId] of [
    ['turn', null],
    ['resume', randomUUID()],
  ] as const) {
    await expect(
      database.query(
        `INSERT INTO backend_runs(id,conversation_id,user_id,service_instance_id,submission_id,request_hash,
      run_kind,root_run_id,sequence_anchor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,0)`,
        [
          randomUUID(),
          task.conversationId,
          actors[0],
          application,
          randomUUID(),
          '0'.repeat(64),
          kind,
          rootId,
        ]
      )
    ).rejects.toMatchObject({ code: '23514' });
  }
});

it.each(['membership', 'permission', 'profile', 'provider', 'expiry'])(
  'rechecks %s after resume preparation, without dispatching or charging another root',
  async change => {
    if (change === 'expiry')
      expireAt = new Date(Date.now() + 4000).toISOString();
    const task = await start();
    const gate = holdPreparation();
    const answer = { submissionId: randomUUID(), action: 'approve' };
    let runId: string | undefined;
    try {
      const response = await respond(task.interaction.id, answer);
      expect(response.statusCode).toBe(202);
      runId = response.json().run.id;
      await gate.ready;
      expect((await stored(runId!)).execution_status).toBe('reserved');
      if (change === 'membership')
        await database.query(
          'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2',
          [group, actors[0]]
        );
      if (change === 'permission')
        await database.query(
          'UPDATE group_app_permissions SET is_enabled=FALSE WHERE id=$1',
          [permission]
        );
      if (change === 'profile')
        await database.query(
          "UPDATE profiles SET status='suspended' WHERE id=$1",
          [actors[0]]
        );
      if (change === 'provider')
        await database.query(
          'UPDATE providers SET is_active=FALSE WHERE id=$1',
          [provider]
        );
      if (change === 'expiry')
        await new Promise(resolve =>
          setTimeout(
            resolve,
            Math.max(0, Date.parse(expireAt!) - Date.now()) + 30
          )
        );
      gate.release();
      const failed = await eventually(
        () => stored(runId!),
        run => run.persistence_status === 'saved'
      );
      expect(failed).toMatchObject({
        execution_status: 'error',
        error_code: 'AGENT_RESUME_NOT_DISPATCHED',
        user_message_id: null,
      });
      expect(failed.result.agui.status).toBe('failed');
      expect(resumePosts()).toHaveLength(0);
      const interaction = (
        await database.query(
          'SELECT * FROM backend_run_interactions WHERE id=$1',
          [task.interaction.id]
        )
      ).rows[0];
      expect(interaction).toMatchObject({
        status: change === 'expiry' ? 'expired' : 'pending',
        submission_id: null,
        request_hash: null,
        decision: null,
        resume_run_id: null,
      });
      expect(
        (
          await database.query(
            'SELECT used_count FROM group_app_permissions WHERE id=$1',
            [permission]
          )
        ).rows[0].used_count
      ).toBe(1);
      expect(
        (
          await database.query(
            "SELECT count(*)::int AS count FROM messages WHERE conversation_id=$1 AND role='user'",
            [task.conversationId]
          )
        ).rows[0].count
      ).toBe(1);
    } finally {
      gate.release();
      await database.query("UPDATE profiles SET status='active' WHERE id=$1", [
        actors[0],
      ]);
      await database.query('UPDATE providers SET is_active=TRUE WHERE id=$1', [
        provider,
      ]);
      await database.query(
        'UPDATE group_app_permissions SET is_enabled=TRUE WHERE id=$1',
        [permission]
      );
      await database.query(
        'INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [group, actors[0]]
      );
    }
    const replay = await respond(task.interaction.id, answer);
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({
      replayed: true,
      run: { id: runId, errorCode: 'AGENT_RESUME_NOT_DISPATCHED' },
    });
  }
);

it('releases an undispatched native preflight failure, replays the old key before preflight, and accepts only an explicit new-key retry', async () => {
  const task = await start();
  const gate = holdPreparation();
  const answer = {
    submissionId: randomUUID(),
    action: 'approve',
    comment: 'Original decision.',
  };
  let firstRunId: string;
  try {
    const response = await respond(task.interaction.id, answer);
    expect(response.statusCode).toBe(202);
    firstRunId = response.json().run.id;
    await gate.ready;
    failNativeReads = true;
    gate.release();
    await eventually(
      () => stored(firstRunId),
      run => run.persistence_status === 'saved'
    );
    const beforeReplay = calls.length;
    const replays = await Promise.all([
      respond(task.interaction.id, answer),
      respond(task.interaction.id, answer, 0, 1),
    ]);
    expect(replays.map(response => response.statusCode)).toEqual([202, 202]);
    for (const replay of replays)
      expect(replay.json()).toMatchObject({
        replayed: true,
        run: {
          id: firstRunId,
          executionStatus: 'error',
          persistenceStatus: 'saved',
          errorCode: 'AGENT_RESUME_NOT_DISPATCHED',
        },
      });
    expect(calls).toHaveLength(beforeReplay);
    expect(
      (await respond(task.interaction.id, { ...answer, comment: 'Changed.' }))
        .statusCode
    ).toBe(409);
    expect((await respond(task.interaction.id, answer, 1)).statusCode).toBe(
      404
    );
    failNativeReads = false;
    const retry = await respond(task.interaction.id, {
      ...answer,
      submissionId: randomUUID(),
    });
    expect(retry.statusCode).toBe(202);
    expect(retry.json().run.id).not.toBe(firstRunId);
    await finish(retry.json().run.id);
    const old = await respond(task.interaction.id, answer);
    expect(old.statusCode).toBe(202);
    expect(old.json()).toMatchObject({
      replayed: true,
      run: { id: firstRunId },
    });
    expect(resumePosts()).toHaveLength(1);
    expect(
      (
        await request(`/conversations/${task.conversationId}/interactions`)
      ).json().interactions[0]
    ).toMatchObject({ status: 'accepted', resumeRunId: retry.json().run.id });
  } finally {
    gate.release();
    failNativeReads = false;
  }
});

it('replays a released key while a new claim exists, without altering that claim or bypassing current authorization', async () => {
  const task = await start();
  const answer = {
    submissionId: randomUUID(),
    action: 'approve' as const,
    comment: '',
  };
  const first = await reservePrepared(task, answer);
  expect(await releaseUndispatchedResume(first.run.id)).toBe(true);
  const second = await reservePrepared(task);
  const before = calls.length;
  const replay = await respond(task.interaction.id, answer);
  expect(replay.statusCode).toBe(202);
  expect(replay.json()).toMatchObject({
    replayed: true,
    run: { id: first.run.id },
  });
  expect(calls).toHaveLength(before);
  expect(
    (await getInteractionForActor(first.app, actors[0], task.interaction.id))
      .resume_run_id
  ).toBe(second.run.id);
  await database.query(
    'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2',
    [group, actors[0]]
  );
  try {
    expect((await respond(task.interaction.id, answer)).statusCode).toBe(404);
  } finally {
    await database.query(
      'INSERT INTO group_members(group_id,user_id) VALUES($1,$2)',
      [group, actors[0]]
    );
  }
  expect(await releaseUndispatchedResume(second.run.id)).toBe(true);
});

it.each(['run', 'interactions'])(
  'GET %s does not cancel normal reserved preparation or issue native reads',
  async queried => {
    const task = await start();
    const gate = holdPreparation();
    try {
      const response = await respond(task.interaction.id, {
        submissionId: randomUUID(),
        action: 'reject',
      });
      expect(response.statusCode).toBe(202);
      await gate.ready;
      const before = calls.length;
      const read = await request(
        queried === 'run'
          ? `/runs/${response.json().run.id}`
          : `/conversations/${task.conversationId}/interactions`
      );
      expect(read.statusCode).toBe(200);
      expect(calls).toHaveLength(before);
      expect(await stored(response.json().run.id)).toMatchObject({
        execution_status: 'reserved',
        persistence_status: 'pending',
        native_run_id: null,
      });
      gate.release();
      await finish(response.json().run.id);
      expect(resumePosts()).toHaveLength(1);
    } finally {
      gate.release();
    }
  }
);

it('serializes the dispatch/release CAS so only one winner can change the reserved claim', async () => {
  const task = await start();
  const prepared = await reservePrepared(task);
  const [marked, released] = await Promise.allSettled([
    markResumeSubmitting(prepared),
    releaseUndispatchedResume(prepared.run.id),
  ]);
  if (marked.status === 'fulfilled') {
    expect(released).toEqual({ status: 'fulfilled', value: false });
    expect((await stored(prepared.run.id)).execution_status).toBe('submitting');
  } else {
    expect(released).toEqual({ status: 'fulfilled', value: true });
    expect((await stored(prepared.run.id)).error_code).toBe(
      'AGENT_RESUME_NOT_DISPATCHED'
    );
  }
  expect(resumePosts()).toHaveLength(0);
});

it('does not count its own reserved slot or re-admit/recharge the root at the dispatch boundary', async () => {
  const task = await start();
  const prepared = await reservePrepared(task);
  await markResumeSubmitting(prepared);
  expect(await releaseUndispatchedResume(prepared.run.id)).toBe(false);
  expect((await stored(prepared.run.id)).execution_status).toBe('submitting');
  expect(
    (
      await database.query(
        'SELECT used_count FROM group_app_permissions WHERE id=$1',
        [permission]
      )
    ).rows[0].used_count
  ).toBe(1);
});

it('requires the original group at the final dispatch boundary even with another valid group grant', async () => {
  const task = await start();
  const prepared = await reservePrepared(task);
  const alternate = randomUUID();
  await database.query('INSERT INTO groups(id,name) VALUES($1,$2)', [
    alternate,
    marker,
  ]);
  try {
    await database.query(
      'INSERT INTO group_app_permissions(group_id,service_instance_id) VALUES($1,$2)',
      [alternate, application]
    );
    await database.query(
      'INSERT INTO group_members(group_id,user_id) VALUES($1,$2)',
      [alternate, actors[0]]
    );
    await database.query(
      'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2',
      [group, actors[0]]
    );
    await expect(markResumeSubmitting(prepared)).rejects.toMatchObject({
      code: 'AGENT_APP_FORBIDDEN',
    });
    expect(await releaseUndispatchedResume(prepared.run.id)).toBe(true);
  } finally {
    await database.query(
      'INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [group, actors[0]]
    );
    await database.query('DELETE FROM groups WHERE id=$1', [alternate]);
  }
});

it.each(['submitting', 'unknown', 'native', 'result', 'accepted'])(
  'never releases a durable %s attempt even without a native lookup match, and the trigger rejects clearing its claim',
  async evidence => {
    const task = await start();
    const prepared = await reservePrepared(task);
    if (evidence === 'submitting' || evidence === 'unknown') {
      await markResumeSubmitting(prepared);
      if (evidence === 'unknown') {
        await database.query(
          "UPDATE backend_runs SET execution_status='unknown',updated_at=NOW()-INTERVAL '1 day' WHERE id=$1",
          [prepared.run.id]
        );
        await database.query(
          "UPDATE backend_run_interactions SET status='unknown' WHERE id=$1",
          [task.interaction.id]
        );
      }
    }
    if (evidence === 'native')
      await database.query(
        'UPDATE backend_runs SET native_run_id=$2 WHERE id=$1',
        [prepared.run.id, randomUUID()]
      );
    if (evidence === 'result')
      await database.query(
        `UPDATE backend_runs SET result='{"executionStatus":"error","messages":[]}'::jsonb WHERE id=$1`,
        [prepared.run.id]
      );
    if (evidence === 'accepted')
      await database.query(
        "UPDATE backend_run_interactions SET status='accepted' WHERE id=$1",
        [task.interaction.id]
      );
    expect(await releaseUndispatchedResume(prepared.run.id)).toBe(false);
    await expect(
      database.query(
        `UPDATE backend_run_interactions SET status='pending',submission_id=NULL,request_hash=NULL,decision=NULL,resume_run_id=NULL WHERE id=$1`,
        [task.interaction.id]
      )
    ).rejects.toMatchObject({ code: '23514' });
    if (evidence === 'submitting' || evidence === 'unknown') {
      await request(`/runs/${prepared.run.id}`);
      await request(`/conversations/${task.conversationId}/interactions`);
      expect((await stored(prepared.run.id)).execution_status).toBe(evidence);
      expect(
        (
          await database.query(
            'SELECT resume_run_id FROM backend_run_interactions WHERE id=$1',
            [task.interaction.id]
          )
        ).rows[0].resume_run_id
      ).toBe(prepared.run.id);
    }
    expect(resumePosts()).toHaveLength(0);
  }
);

it('only permits all-or-nothing clearing, not claim replacement or identity edits', async () => {
  const task = await start();
  const prepared = await reservePrepared(task);
  for (const update of [
    'submission_id=NULL',
    'request_hash=NULL',
    'decision=NULL',
    'resume_run_id=NULL',
    'submission_id=gen_random_uuid()',
    "prompt='{}'::jsonb",
  ]) {
    await expect(
      database.query(
        `UPDATE backend_run_interactions SET ${update} WHERE id=$1`,
        [task.interaction.id]
      )
    ).rejects.toMatchObject({ code: '23514' });
  }
  expect(await releaseUndispatchedResume(prepared.run.id)).toBe(true);
  await expect(markResumeSubmitting(prepared)).rejects.toMatchObject({
    code: 'AGENT_RESUME_NOT_DISPATCHED',
  });
  expect(await releaseUndispatchedResume(prepared.run.id)).toBe(false);
});

it('finishes the root ledger when the first GET run recovers native-error phase-two persistence, allowing normal deletion', async () => {
  initialNativeError = true;
  const fault = `hitl_save_${randomUUID().replaceAll('-', '')}`;
  await database.query(`CREATE SEQUENCE ${fault}`);
  await database.query(`GRANT USAGE,SELECT ON SEQUENCE ${fault} TO "${role}"`);
  await database.query(`CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.user_id = '${actors[0]}'::uuid AND NEW.execution_status = 'error'
      AND NEW.persistence_status = 'saved' AND OLD.persistence_status <> 'saved'
      AND nextval('${fault}') = 1 THEN RAISE EXCEPTION 'synthetic phase-two save failure'; END IF;
    RETURN NEW; END; $$`);
  await database.query(
    `CREATE TRIGGER ${fault} BEFORE UPDATE OF persistence_status ON backend_runs FOR EACH ROW EXECUTE FUNCTION ${fault}()`
  );
  try {
    const response = await servers[0].inject({
      method: 'POST',
      url: endpoint('/runs'),
      headers: {
        cookie: `session_token=${tokens[0]}`,
        'x-agentifui-protocol': 'ag-ui/1.0',
      },
      payload: {
        submissionId: randomUUID(),
        content: 'Synthetic initial native error.',
      },
    });
    expect(response.statusCode).toBe(200);
    const rows = await database.query(
      'SELECT * FROM backend_runs WHERE user_id=$1',
      [actors[0]]
    );
    expect(rows.rows).toHaveLength(1);
    const run = rows.rows[0];
    expect(run).toMatchObject({
      execution_status: 'error',
      persistence_status: 'failed',
      result: { executionStatus: 'error' },
    });
    expect(
      (
        await database.query(
          'SELECT state FROM agent_submissions WHERE run_id=$1',
          [run.id]
        )
      ).rows[0].state
    ).toBe('unknown');
    const posts = calls.filter(call => call.method === 'POST').length;
    const repaired = await request(`/runs/${run.id}`);
    expect(repaired.statusCode).toBe(200);
    expect(await stored(run.id)).toMatchObject({
      execution_status: 'error',
      persistence_status: 'saved',
    });
    expect(
      (
        await database.query(
          'SELECT state,quota_state FROM agent_submissions WHERE run_id=$1',
          [run.id]
        )
      ).rows[0]
    ).toMatchObject({ state: 'finished', quota_state: 'counted' });
    await request(`/runs/${run.id}`);
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(posts);
    expect(
      (
        await database.query(
          'SELECT used_count FROM group_app_permissions WHERE id=$1',
          [permission]
        )
      ).rows[0].used_count
    ).toBe(1);
    const removed = await servers[0].inject({
      method: 'DELETE',
      url: endpoint(`/conversations/${run.conversation_id}`),
      headers: { cookie: `session_token=${tokens[0]}` },
    });
    expect(removed.statusCode).toBe(204);
  } finally {
    await database.query(`DROP TRIGGER ${fault} ON backend_runs`);
    await database.query(`DROP FUNCTION ${fault}()`);
    await database.query(`DROP SEQUENCE ${fault}`);
  }
});
