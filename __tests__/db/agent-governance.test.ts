/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import {
  admitSubmission,
  confirmSubmission,
  markSubmissionSubmitting,
  registerSubmission,
  rejectSubmission,
  rejectUnacceptedSubmission,
  submissionHash,
  submissionStorage,
} from '../../apps/api/src/lib/agent-submissions';
import { getPgPool } from '../../apps/api/src/lib/pg-context';
import { resolveTestDatabaseUrl } from './helpers/test-database-url';

const actors = [randomUUID(), randomUUID()];
const provider = randomUUID();
const application = randomUUID();
const group = randomUUID();
const permission = randomUUID();
const name = `governance-${randomUUID()}`;
const role = `governance_${randomUUID().replaceAll('-', '')}`;
const original = { ...process.env };
const target = submissionHash([application, 'https://example.invalid', name]);
let database: Pool;

function register(
  actor = 0,
  id = randomUUID(),
  content = 'Synthetic question'
) {
  return registerSubmission({
    userId: actors[actor],
    serviceInstanceId: application,
    submissionId: id,
    backendType: 'dify',
    request: { content },
    targetFingerprint: target,
  });
}

function admit(task: string, actor = 0) {
  return submissionStorage(client =>
    admitSubmission(client, task, actors[actor], application, {
      userLimit: 2,
      appLimit: 5,
    })
  );
}

beforeAll(async () => {
  database = new Pool({ connectionString: resolveTestDatabaseUrl() });
  await database.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  await database.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await database.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}`
  );
  await database.query(
    `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`
  );
  for (const id of actors) {
    await database.query(
      'INSERT INTO auth_users(id,name,email) VALUES($1,$2,$3)',
      [id, name, `${id}@example.invalid`]
    );
    await database.query(
      "INSERT INTO profiles(id,email,role,status) VALUES($1,$2,'user','active')",
      [id, `${id}@example.invalid`]
    );
  }
  await database.query(
    "INSERT INTO providers(id,name,type,base_url,auth_type) VALUES($1,$2,'dify','https://example.invalid','bearer')",
    [provider, name]
  );
  await database.query(
    "INSERT INTO service_instances(id,provider_id,instance_id,visibility,config) VALUES($1,$2,$3,'group_only','{}')",
    [application, provider, name]
  );
  await database.query('INSERT INTO groups(id,name) VALUES($1,$2)', [
    group,
    name,
  ]);
  await database.query(
    'INSERT INTO group_app_permissions(id,group_id,service_instance_id,usage_quota) VALUES($1,$2,$3,1)',
    [permission, group, application]
  );
  for (const id of actors)
    await database.query(
      'INSERT INTO group_members(group_id,user_id) VALUES($1,$2)',
      [group, id]
    );
  const scoped = new URL(resolveTestDatabaseUrl());
  scoped.searchParams.set(
    'options',
    `-c role=${role} -c app.rls_strict_mode=on`
  );
  process.env.DATABASE_URL = scoped.toString();
  process.env.APP_RLS_STRICT_MODE = 'true';
}, 30000);

beforeEach(async () => {
  await database.query(
    'DELETE FROM agent_submissions WHERE user_id=ANY($1::uuid[])',
    [actors]
  );
  await database.query(
    'INSERT INTO group_app_permissions(id,group_id,service_instance_id,usage_quota) VALUES($1,$2,$3,1) ON CONFLICT(id) DO UPDATE SET used_count=0,usage_quota=1,is_enabled=TRUE',
    [permission, group, application]
  );
});

afterAll(async () => {
  const state = globalThis as Record<string, unknown>;
  if (state.__agentifui_fastify_pg_pool__) await getPgPool().end();
  delete state.__agentifui_fastify_pg_pool__;
  if (database) {
    await database.query(
      'DELETE FROM agent_submissions WHERE user_id=ANY($1::uuid[])',
      [actors]
    );
    await database.query('DELETE FROM groups WHERE id=$1', [group]);
    await database.query('DELETE FROM providers WHERE id=$1', [provider]);
    await database.query('DELETE FROM profiles WHERE id=ANY($1::uuid[])', [
      actors,
    ]);
    await database.query('DELETE FROM auth_users WHERE id=ANY($1::uuid[])', [
      actors,
    ]);
    await database.query(`DROP OWNED BY ${role}`);
    await database.query(`DROP ROLE ${role}`);
    await database.end();
  }
  for (const key of ['DATABASE_URL', 'APP_RLS_STRICT_MODE']) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

it('uses FORCE RLS with a non-superuser application role and hides task rows outside system context', async () => {
  await register();
  const identity = await getPgPool().query(
    'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user'
  );
  expect(identity.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  const relation = await database.query(
    "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='agent_submissions'::regclass"
  );
  expect(relation.rows[0]).toEqual({
    relrowsecurity: true,
    relforcerowsecurity: true,
  });
  expect(
    (await getPgPool().query('SELECT * FROM agent_submissions')).rows
  ).toHaveLength(0);
});

it('atomically admits only one of two users competing for the last quota and counts acceptance only once', async () => {
  const tasks = await Promise.all([register(0), register(1)]);
  const outcomes = await Promise.allSettled(
    tasks.map((entry, actor) => admit(entry.task.root_task_id, actor))
  );
  expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(
    1
  );
  const rejected = outcomes.find(
    value => value.status === 'rejected'
  ) as PromiseRejectedResult;
  expect(rejected.reason.code).toBe('AGENT_QUOTA_EXCEEDED');
  const winner =
    tasks[outcomes.findIndex(value => value.status === 'fulfilled')].task
      .root_task_id;
  await markSubmissionSubmitting(winner);
  await Promise.all([
    confirmSubmission(winner, 'accepted'),
    confirmSubmission(winner, 'accepted'),
  ]);
  await confirmSubmission(winner, 'finished');
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
        'SELECT state,quota_state FROM agent_submissions WHERE root_task_id=$1',
        [winner]
      )
    ).rows[0]
  ).toEqual({ state: 'finished', quota_state: 'counted' });
});

it('keeps a replay attached to one task and rejects changed input without allocating another', async () => {
  const id = randomUUID();
  const first = await register(0, id);
  const replay = await register(0, id);
  expect(replay.replayed).toBe(true);
  expect(replay.task.root_task_id).toBe(first.task.root_task_id);
  await expect(register(0, id, 'Changed question')).rejects.toMatchObject({
    code: 'AGENT_SUBMISSION_MISMATCH',
  });
});

it('does not let confirmed historical quota block permission revocation', async () => {
  const entry = await register();
  await admit(entry.task.root_task_id);
  await markSubmissionSubmitting(entry.task.root_task_id);
  await confirmSubmission(entry.task.root_task_id, 'finished');
  await expect(
    database.query('DELETE FROM group_app_permissions WHERE id=$1', [
      permission,
    ])
  ).resolves.toBeDefined();
  const task = await database.query(
    'SELECT quota_state,quota_permission_id FROM agent_submissions WHERE root_task_id=$1',
    [entry.task.root_task_id]
  );
  expect(task.rows[0]).toEqual({
    quota_state: 'counted',
    quota_permission_id: null,
  });
});

it('protects unknown reserved quota and target identity but allows display changes and disabling', async () => {
  const entry = await register();
  await admit(entry.task.root_task_id);
  await markSubmissionSubmitting(entry.task.root_task_id);
  await confirmSubmission(entry.task.root_task_id, 'unknown');
  await expect(
    database.query('DELETE FROM group_app_permissions WHERE id=$1', [
      permission,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    database.query(
      'UPDATE service_instances SET config=$2::jsonb WHERE id=$1',
      [application, { backend_type: 'langchain' }]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await database.query(
    'UPDATE group_app_permissions SET used_count=1 WHERE id=$1',
    [permission]
  );
  await expect(
    database.query(
      'UPDATE group_app_permissions SET used_count=0 WHERE id=$1',
      [permission]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    database.query('DELETE FROM profiles WHERE id=$1', [actors[0]])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    database.query(
      "UPDATE service_instances SET display_name='Updated display' WHERE id=$1",
      [application]
    )
  ).resolves.toBeDefined();
  await expect(
    database.query('UPDATE providers SET is_active=FALSE WHERE id=$1', [
      provider,
    ])
  ).resolves.toBeDefined();
  await database.query('UPDATE providers SET is_active=TRUE WHERE id=$1', [
    provider,
  ]);
  await rejectSubmission(entry.task.root_task_id, 'MUST_NOT_RELEASE_UNKNOWN');
  expect(
    (
      await database.query(
        'SELECT state,quota_state FROM agent_submissions WHERE root_task_id=$1',
        [entry.task.root_task_id]
      )
    ).rows[0]
  ).toEqual({ state: 'unknown', quota_state: 'reserved' });
});

it('releases a definite native rejection without counting and admits the next question', async () => {
  const first = await register();
  await admit(first.task.root_task_id);
  await markSubmissionSubmitting(first.task.root_task_id);
  await rejectUnacceptedSubmission(first.task.root_task_id);
  const second = await register();
  await expect(admit(second.task.root_task_id)).resolves.toBeUndefined();
  expect(
    (
      await database.query(
        'SELECT used_count FROM group_app_permissions WHERE id=$1',
        [permission]
      )
    ).rows[0].used_count
  ).toBe(0);
});

it('rejects reserved permission deletion before a locked acceptance can form a deadlock', async () => {
  const entry = await register();
  const task = entry.task.root_task_id;
  await admit(task);
  await markSubmissionSubmitting(task);
  const locked = await database.connect();
  const revoker = await database.connect();
  try {
    await locked.query('BEGIN');
    await locked.query(
      'SELECT root_task_id FROM agent_submissions WHERE root_task_id=$1 FOR UPDATE',
      [task]
    );
    await revoker.query("SET statement_timeout='1500ms'");
    await expect(
      revoker.query('DELETE FROM group_app_permissions WHERE id=$1', [
        permission,
      ])
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await locked.query('ROLLBACK');
    await revoker.query('RESET statement_timeout');
    locked.release();
    revoker.release();
  }
  await confirmSubmission(task, 'finished');
  expect(
    (
      await database.query(
        'SELECT used_count FROM group_app_permissions WHERE id=$1',
        [permission]
      )
    ).rows[0].used_count
  ).toBe(1);
});

it.each(['application', 'provider'])(
  'rejects competing %s identity edits without waiting on the admission advisory lock',
  async kind => {
    const holder = await database.connect();
    const editor = await database.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`agent-app:${application}`]
      );
      await editor.query("SET statement_timeout='1500ms'");
      const operation =
        kind === 'application'
          ? editor.query(
              'UPDATE service_instances SET instance_id=$2 WHERE id=$1',
              [application, `${name}-changed`]
            )
          : editor.query('UPDATE providers SET base_url=$2 WHERE id=$1', [
              provider,
              'https://changed.example.invalid',
            ]);
      await expect(operation).rejects.toMatchObject({ code: '23514' });
    } finally {
      await holder.query('ROLLBACK');
      await editor.query('RESET statement_timeout');
      holder.release();
      editor.release();
    }
    const entry = await register();
    await expect(admit(entry.task.root_task_id)).resolves.toBeUndefined();
  }
);

it('restores the restricted administrative connection context after normal and rejected trigger exits', async () => {
  const entry = await register();
  await admit(entry.task.root_task_id);
  const administrator = await database.connect();
  try {
    await administrator.query('BEGIN');
    await administrator.query(`SET LOCAL ROLE ${role}`);
    await administrator.query(
      "SELECT set_config('app.rls_system_actor','false',true),set_config('app.current_user_role','admin',true),set_config('app.current_user_id',$1,true),set_config('app.rls_strict_mode','true',true)",
      [actors[0]]
    );
    await administrator.query(
      "UPDATE service_instances SET display_name='Synthetic context check' WHERE id=$1",
      [application]
    );
    expect(
      (
        await administrator.query(
          "SELECT current_setting('app.rls_system_actor') AS context"
        )
      ).rows[0].context
    ).toBe('false');
    await administrator.query('SAVEPOINT rejected_edit');
    await expect(
      administrator.query(
        'UPDATE service_instances SET instance_id=$2 WHERE id=$1',
        [application, `${name}-forbidden`]
      )
    ).rejects.toMatchObject({ code: '23514' });
    await administrator.query('ROLLBACK TO SAVEPOINT rejected_edit');
    expect(
      (
        await administrator.query(
          "SELECT current_setting('app.rls_system_actor') AS context"
        )
      ).rows[0].context
    ).toBe('false');
    expect(
      (await administrator.query('SELECT root_task_id FROM agent_submissions'))
        .rows
    ).toHaveLength(0);
  } finally {
    await administrator.query('ROLLBACK');
    administrator.release();
  }
});
