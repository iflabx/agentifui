/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import type { ApiRuntimeConfig } from '../../apps/api/src/config';
import { getPgPool } from '../../apps/api/src/lib/pg-context';
import { createApiServer } from '../../apps/api/src/server';
import { resolveTestDatabaseUrl } from './helpers/test-database-url';
import { createTestRole, dropTestRole } from './helpers/test-role';

jest.mock('../../apps/api/src/lib/error-events', () => ({
  recordApiErrorEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.setTimeout(30000);

type InteractionState = 'pending' | 'submitting' | 'unknown' | 'accepted';
interface TaskFixture {
  taskId: string;
  rootRunId: string;
  resumeRunId: string | null;
  conversationId: string;
  privateMarkers: string[];
}
interface TaskProjection {
  task_id: string;
  run_id: string;
  owner_id: string;
  app_id: string;
  execution_status: string;
  persistence_status: string;
  run_kind: string;
  interaction_status: InteractionState | null;
  occupies_slot: boolean;
  blocking_reason: string | null;
}

const originalEnvironment = { ...process.env };
const actorId = randomUUID();
const ownerId = randomUUID();
const actorToken = randomUUID();
const ownerToken = randomUUID();
const providerId = randomUUID();
const appId = randomUUID();
const marker = `gov-task-operations-${randomUUID()}`;
const runtimeRole = `gov_tasks_${randomUUID().replaceAll('-', '')}`;
let database: Pool | undefined;
let server: Awaited<ReturnType<typeof createApiServer>> | undefined;
let roleCreated = false;

const config: ApiRuntimeConfig = {
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  corsAllowedOrigins: ['https://ui.example.invalid'],
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

function fixtureDatabase(): Pool {
  if (!database)
    throw new Error('Governance task fixtures are not initialized');
  return database;
}

function call(
  payload: Record<string, unknown>,
  token: string | null = actorToken
) {
  if (!server) throw new Error('Governance task API is not initialized');
  return server.inject({
    method: 'POST',
    url: '/api/internal/data',
    headers: token ? { cookie: `session_token=${token}` } : {},
    payload: { action: 'tasks.getRecent', payload },
  });
}

async function queryTasks(
  payload: Record<string, unknown>
): Promise<TaskProjection[]> {
  const response = await call({ page: 1, limit: 100, ...payload });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    success: true,
    data: { readOnly: true },
  });
  return response.json().data.tasks as TaskProjection[];
}

async function createTask(options: {
  interaction: InteractionState | null;
  linkedSubmission?: boolean;
}): Promise<TaskFixture> {
  const rootRunId = randomUUID();
  const taskId = options.linkedSubmission === false ? rootRunId : randomUUID();
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const rootSubmissionId = randomUUID();
  const resumeSubmissionId = randomUUID();
  const resumeRunId =
    options.interaction && options.interaction !== 'pending'
      ? randomUUID()
      : null;
  const threadId = `synthetic-native-thread-${randomUUID()}`;
  const prompt = `synthetic-private-prompt-${randomUUID()}`;
  const checkpoint = `synthetic-private-checkpoint-${randomUUID()}`;
  const fingerprint = 'a'.repeat(64);
  const requestHash = 'b'.repeat(64);
  const client = await fixtureDatabase().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.rls_system_actor','true',true)");
    await client.query(
      'INSERT INTO conversations(id,user_id,title,app_id) VALUES($1,$2,$3,$4)',
      [conversationId, ownerId, marker, appId]
    );
    await client.query(
      "INSERT INTO backend_conversations(conversation_id,service_instance_id,backend_type,config_fingerprint,thread_id,human_input) VALUES($1,$2,'langchain',$3,$4,true)",
      [conversationId, appId, fingerprint, threadId]
    );
    await client.query(
      "INSERT INTO messages(id,conversation_id,user_id,role,content,sequence_index) VALUES($1,$2,$3,'user',$4,0)",
      [messageId, conversationId, ownerId, prompt]
    );
    await client.query(
      `INSERT INTO backend_runs(id,conversation_id,user_id,service_instance_id,submission_id,
        request_hash,user_message_id,run_kind,root_run_id,execution_status,persistence_status)
       VALUES($1,$2,$3,$4,$5,$6,$7,'turn',$1,'waiting','saved')`,
      [
        rootRunId,
        conversationId,
        ownerId,
        appId,
        rootSubmissionId,
        requestHash,
        messageId,
      ]
    );
    if (options.linkedSubmission !== false) {
      await client.query(
        `INSERT INTO agent_submissions(root_task_id,user_id,service_instance_id,submission_id,
          request_hash,target_fingerprint,backend_type,state,quota_state,run_id)
         VALUES($1,$2,$3,$4,$5,$6,'langchain','finished','none',$7)`,
        [
          taskId,
          ownerId,
          appId,
          rootSubmissionId,
          requestHash,
          fingerprint,
          rootRunId,
        ]
      );
    }
    if (resumeRunId) {
      const executionStatus =
        options.interaction === 'accepted'
          ? 'success'
          : options.interaction === 'unknown'
            ? 'unknown'
            : 'running';
      await client.query(
        `INSERT INTO backend_runs(id,conversation_id,user_id,service_instance_id,submission_id,
          request_hash,run_kind,root_run_id,sequence_anchor,execution_status,persistence_status)
         VALUES($1,$2,$3,$4,$5,$6,'resume',$7,0,$8,$9)`,
        [
          resumeRunId,
          conversationId,
          ownerId,
          appId,
          resumeSubmissionId,
          requestHash,
          rootRunId,
          executionStatus,
          options.interaction === 'accepted' ? 'saved' : 'pending',
        ]
      );
    }
    if (options.interaction) {
      await client.query(
        `INSERT INTO backend_run_interactions(id,origin_run_id,native_interrupt_id,checkpoint,prompt,
          status,submission_id,request_hash,decision,resume_run_id)
         VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9::jsonb,$10)`,
        [
          randomUUID(),
          rootRunId,
          `synthetic-native-interrupt-${randomUUID()}`,
          JSON.stringify({ checkpoint }),
          JSON.stringify({
            title: prompt,
            actions: ['approve', 'reject'],
            commentMaxLength: 100,
          }),
          options.interaction,
          resumeRunId ? resumeSubmissionId : null,
          resumeRunId ? requestHash : null,
          resumeRunId
            ? JSON.stringify({
                action: 'approve',
                comment: 'synthetic decision',
              })
            : null,
          resumeRunId,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return {
    taskId,
    rootRunId,
    resumeRunId,
    conversationId,
    privateMarkers: [threadId, prompt, checkpoint, fingerprint, requestHash],
  };
}

async function ledgerState(fixture: TaskFixture) {
  const connection = fixtureDatabase();
  return {
    submissions: (
      await connection.query(
        'SELECT * FROM agent_submissions WHERE run_id=$1 ORDER BY root_task_id',
        [fixture.rootRunId]
      )
    ).rows,
    runs: (
      await connection.query(
        'SELECT * FROM backend_runs WHERE conversation_id=$1 ORDER BY id',
        [fixture.conversationId]
      )
    ).rows,
    interactions: (
      await connection.query(
        'SELECT * FROM backend_run_interactions WHERE origin_run_id=$1 ORDER BY id',
        [fixture.rootRunId]
      )
    ).rows,
    messages: (
      await connection.query(
        'SELECT * FROM messages WHERE conversation_id=$1 ORDER BY id',
        [fixture.conversationId]
      )
    ).rows,
  };
}

beforeAll(async () => {
  const url = resolveTestDatabaseUrl();
  const databasePath = new URL(url).pathname;
  if (
    !databasePath.startsWith('/gov_verify_') &&
    databasePath !== '/agentifui_test'
  ) {
    throw new Error(
      'Governance task operations require a dedicated gov_verify_ database or agentifui_test'
    );
  }
  database = new Pool({ connectionString: url });
  await createTestRole(database, runtimeRole);
  roleCreated = true;
  for (const [userId, accountRole, token] of [
    [actorId, 'admin', actorToken],
    [ownerId, 'user', ownerToken],
  ]) {
    await database.query(
      'INSERT INTO auth_users(id,name,email) VALUES($1,$2,$3)',
      [userId, marker, `${userId}@example.invalid`]
    );
    await database.query(
      "INSERT INTO profiles(id,email,role,status) VALUES($1,$2,$3,'active')",
      [userId, `${userId}@example.invalid`, accountRole]
    );
    await database.query(
      "INSERT INTO auth_sessions(user_id,token,expires_at) VALUES($1,$2,NOW()+interval '1 hour')",
      [userId, token]
    );
  }
  await database.query(
    "INSERT INTO providers(id,name,type,base_url,auth_type) VALUES($1,$2,'dify','https://upstream.example.invalid','bearer')",
    [providerId, marker]
  );
  await database.query(
    "INSERT INTO service_instances(id,provider_id,instance_id,visibility,config) VALUES($1,$2,$3,'public',$4::jsonb)",
    [
      appId,
      providerId,
      marker,
      JSON.stringify({
        backend_type: 'langchain',
        langchain: {
          assistant_id: 'synthetic-task-assistant',
          human_input: true,
        },
      }),
    ]
  );
  const scopedUrl = new URL(url);
  scopedUrl.searchParams.set(
    'options',
    `-c role=${runtimeRole} -c app.rls_strict_mode=on`
  );
  process.env.DATABASE_URL = scopedUrl.toString();
  process.env.APP_RLS_STRICT_MODE = 'true';
  process.env.API_ENCRYPTION_KEY = 'synthetic-governance-tasks-master';
  server = await createApiServer(config);
});

afterAll(async () => {
  try {
    if (server) await server.close();
    const state = globalThis as Record<string, unknown>;
    if (state.__agentifui_fastify_pg_pool__) {
      await getPgPool().end();
      delete state.__agentifui_fastify_pg_pool__;
    }
    delete state.__agentifui_fastify_session_resolver_cache__;
    if (database) {
      await database.query(
        "UPDATE backend_runs SET execution_status='error',persistence_status='saved' WHERE user_id=$1",
        [ownerId]
      );
      const pending = await database.query(
        `SELECT interaction.*,origin.conversation_id,origin.service_instance_id,origin.root_run_id
         FROM backend_run_interactions interaction JOIN backend_runs origin ON origin.id=interaction.origin_run_id
         WHERE origin.user_id=$1 AND interaction.status<>'accepted'`,
        [ownerId]
      );
      for (const interaction of pending.rows) {
        const resumeId = interaction.resume_run_id || randomUUID();
        const cleanupSubmissionId = interaction.submission_id || randomUUID();
        if (!interaction.resume_run_id) {
          await database.query(
            `INSERT INTO backend_runs(id,conversation_id,user_id,service_instance_id,submission_id,
              request_hash,run_kind,root_run_id,sequence_anchor,execution_status,persistence_status)
             VALUES($1,$2,$3,$4,$5,$6,'resume',$7,0,'error','saved')`,
            [
              resumeId,
              interaction.conversation_id,
              ownerId,
              interaction.service_instance_id,
              cleanupSubmissionId,
              'c'.repeat(64),
              interaction.root_run_id,
            ]
          );
        }
        await database.query(
          `UPDATE backend_run_interactions SET status='accepted',submission_id=COALESCE(submission_id,$2::uuid),
            request_hash=COALESCE(request_hash,$3),decision=COALESCE(decision,'{"action":"reject","comment":"synthetic cleanup"}'::jsonb),
            resume_run_id=COALESCE(resume_run_id,$4::uuid) WHERE id=$1`,
          [interaction.id, cleanupSubmissionId, 'c'.repeat(64), resumeId]
        );
      }
      await database.query(
        "UPDATE agent_submissions SET state='finished',quota_state=CASE WHEN quota_state='reserved' THEN 'released' ELSE quota_state END WHERE user_id=$1",
        [ownerId]
      );
      await database.query('DELETE FROM conversations WHERE user_id=$1', [
        ownerId,
      ]);
      await database.query('DELETE FROM agent_submissions WHERE user_id=$1', [
        ownerId,
      ]);
      await database.query('DELETE FROM service_instances WHERE id=$1', [
        appId,
      ]);
      await database.query('DELETE FROM providers WHERE id=$1', [providerId]);
      await database.query('DELETE FROM profiles WHERE id=ANY($1::uuid[])', [
        [actorId, ownerId],
      ]);
      await database.query('DELETE FROM auth_users WHERE id=ANY($1::uuid[])', [
        [actorId, ownerId],
      ]);
      if (roleCreated) await dropTestRole(database, runtimeRole);
    }
  } finally {
    if (database) await database.end();
    process.env = originalEnvironment;
  }
});

test('root submission and resume share the governance task ID, not the different root run ID', async () => {
  const fixture = await createTask({ interaction: 'submitting' });
  expect(fixture.taskId).not.toBe(fixture.rootRunId);
  expect(fixture.resumeRunId).not.toBeNull();
  const rows = await queryTasks({ taskId: fixture.taskId, appId });
  expect(rows).toHaveLength(2);
  expect(rows.map(row => row.run_id).sort()).toEqual(
    [fixture.rootRunId, fixture.resumeRunId].sort()
  );
  expect(
    rows.every(
      row =>
        row.task_id === fixture.taskId &&
        row.owner_id === ownerId &&
        row.app_id === appId
    )
  ).toBe(true);
  expect(rows.filter(row => row.occupies_slot)).toHaveLength(1);
  expect(rows.find(row => row.occupies_slot)?.run_id).toBe(fixture.resumeRunId);
  const resume = await queryTasks({ taskId: fixture.resumeRunId });
  expect(resume).toHaveLength(1);
  expect(resume[0]).toMatchObject({
    task_id: fixture.taskId,
    run_id: fixture.resumeRunId,
    run_kind: 'resume',
    execution_status: 'running',
    occupies_slot: true,
  });
  expect(await queryTasks({ taskId: fixture.rootRunId })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        task_id: fixture.taskId,
        run_id: fixture.rootRunId,
      }),
    ])
  );
});

test('backend-only resume falls back to root_run_id when no root submission exists', async () => {
  const fixture = await createTask({
    interaction: 'accepted',
    linkedSubmission: false,
  });
  expect(
    (
      await fixtureDatabase().query(
        'SELECT root_task_id FROM agent_submissions WHERE run_id=$1',
        [fixture.rootRunId]
      )
    ).rows
  ).toEqual([]);
  const rows = await queryTasks({ taskId: fixture.rootRunId });
  expect(rows).toHaveLength(2);
  expect(rows.every(row => row.task_id === fixture.rootRunId)).toBe(true);
  expect(rows.map(row => row.run_id).sort()).toEqual(
    [fixture.rootRunId, fixture.resumeRunId].sort()
  );
  expect(rows.every(row => !row.occupies_slot)).toBe(true);
  expect((await queryTasks({ taskId: fixture.resumeRunId }))[0]).toMatchObject({
    task_id: fixture.rootRunId,
    run_id: fixture.resumeRunId,
    run_kind: 'resume',
  });
});

test('pending interaction reports waiting for input without occupying a compute slot', async () => {
  const fixture = await createTask({ interaction: 'pending' });
  expect(await queryTasks({ taskId: fixture.taskId })).toEqual([
    expect.objectContaining({
      run_id: fixture.rootRunId,
      execution_status: 'waiting',
      interaction_status: 'pending',
      blocking_reason: 'WAITING_FOR_INPUT',
      occupies_slot: false,
    }),
  ]);
});

test('legacy waiting run without an interaction retains the waiting projection', async () => {
  const fixture = await createTask({
    interaction: null,
    linkedSubmission: false,
  });
  expect(await queryTasks({ taskId: fixture.taskId })).toEqual([
    expect.objectContaining({
      run_id: fixture.rootRunId,
      execution_status: 'waiting',
      interaction_status: null,
      blocking_reason: 'WAITING_FOR_INPUT',
      occupies_slot: false,
    }),
  ]);
});

test('accepted interaction does not make its saved waiting root require another response', async () => {
  const fixture = await createTask({ interaction: 'accepted' });
  const rows = await queryTasks({ taskId: fixture.taskId });
  expect(rows).toHaveLength(2);
  expect(rows.find(row => row.run_id === fixture.rootRunId)).toMatchObject({
    execution_status: 'waiting',
    persistence_status: 'saved',
    interaction_status: 'accepted',
    blocking_reason: null,
    occupies_slot: false,
  });
  expect(rows.find(row => row.run_id === fixture.resumeRunId)).toMatchObject({
    execution_status: 'success',
    persistence_status: 'saved',
    blocking_reason: null,
    occupies_slot: false,
  });
});

test.each([
  {
    interaction: 'submitting' as const,
    reason: 'RESUME_IN_PROGRESS',
    execution: 'running',
  },
  {
    interaction: 'unknown' as const,
    reason: 'UPSTREAM_UNCONFIRMED',
    execution: 'unknown',
  },
])(
  '$interaction interaction is not advertised as accepting another input',
  async ({ interaction, reason, execution }) => {
    const fixture = await createTask({ interaction });
    const rows = await queryTasks({ taskId: fixture.taskId });
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.run_id === fixture.rootRunId)).toMatchObject({
      execution_status: 'waiting',
      interaction_status: interaction,
      blocking_reason: reason,
      occupies_slot: false,
    });
    expect(rows.find(row => row.run_id === fixture.resumeRunId)).toMatchObject({
      execution_status: execution,
      occupies_slot: true,
    });
    expect(rows.some(row => row.blocking_reason === 'WAITING_FOR_INPUT')).toBe(
      false
    );
  }
);

test('task and resume reads preserve unknown ledgers and omit native identifiers and content', async () => {
  const fixture = await createTask({ interaction: 'unknown' });
  const before = await ledgerState(fixture);
  const originalFetch = globalThis.fetch;
  const upstream = jest.fn(async () => {
    throw new Error('Task investigation must not contact an upstream service');
  });
  globalThis.fetch = upstream;
  try {
    const responses = [
      await call({ taskId: fixture.taskId }),
      await call({ taskId: fixture.resumeRunId }),
      await call({ taskId: fixture.taskId, state: 'unknown' }),
    ];
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.json().data.readOnly).toBe(true);
      for (const privateMarker of fixture.privateMarkers)
        expect(response.body).not.toContain(privateMarker);
      expect(response.body).not.toMatch(
        /"(?:thread_id|native_run_id|native_interrupt_id|checkpoint|prompt|decision|request_hash|target_fingerprint)"\s*:/
      );
    }
    expect(responses[2].json().data.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_id: fixture.taskId,
          run_id: fixture.resumeRunId,
          execution_status: 'unknown',
        }),
      ])
    );
    expect(await ledgerState(fixture)).toEqual(before);
    expect(upstream).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ordinary owners and anonymous requests cannot use the administrative task projection', async () => {
  expect((await call({ appId }, ownerToken)).statusCode).toBe(403);
  expect((await call({ appId }, null)).statusCode).toBe(401);
});
