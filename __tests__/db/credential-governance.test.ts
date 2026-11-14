/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Pool, type PoolClient } from 'pg';

import type { ApiRuntimeConfig } from '../../apps/api/src/config';
import { resolveAgentApp } from '../../apps/api/src/lib/agent-app';
import {
  admitSubmission,
  confirmSubmission,
  markSubmissionSubmitting,
  registerSubmission,
  submissionHash,
  submissionStorage,
} from '../../apps/api/src/lib/agent-submissions';
import { resolveDifyConfig } from '../../apps/api/src/lib/dify-config';
import { getPgPool } from '../../apps/api/src/lib/pg-context';
import { createApiServer } from '../../apps/api/src/server';
import { resolveTestDatabaseUrl } from './helpers/test-database-url';

jest.mock('../../apps/api/src/lib/error-events', () => ({
  recordApiErrorEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.setTimeout(30000);

const original = { ...process.env };
const actors = [randomUUID(), randomUUID()];
const tokens = actors.map(() => randomUUID());
const providers = [randomUUID(), randomUUID()];
const applications = [randomUUID(), randomUUID(), randomUUID()];
const keys = Array.from({ length: 5 }, () => randomUUID());
const group = randomUUID();
const permission = randomUUID();
const marker = `credential-governance-${randomUUID()}`;
const role = `credential_${randomUUID().replaceAll('-', '')}`;
const gate = `${role}_gate`;
const servers: Awaited<ReturnType<typeof createApiServer>>[] = [];
const origins: string[] = [];
let database: Pool;

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

async function action(
  name: string,
  payload: Record<string, unknown>,
  actor = 0,
  server = 0
): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = JSON.stringify({ action: name, payload });
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      `${origins[server]}/api/internal/data`,
      {
        method: 'POST',
        headers: {
          cookie: `session_token=${tokens[actor]}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode!,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          })
        );
      }
    );
    request.on('error', reject);
    request.setTimeout(10000, () =>
      request.destroy(new Error('Synthetic management request timed out'))
    );
    request.end(body);
  });
}

async function waitFor(operation: () => Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!(await operation())) {
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for database lock');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function register(app = 0, credentialVersion?: string) {
  if (credentialVersion === undefined && app !== 2) {
    credentialVersion =
      app === 0
        ? (
            await resolveDifyConfig(`${marker}-${app}`, {
              actorUserId: actors[1],
            })
          )?.credentialVersion
        : (await resolveAgentApp(applications[app], actors[1]))
            .credentialVersion;
    expect(credentialVersion).toMatch(/^[\da-f-]{36}$/);
  }
  return registerSubmission({
    userId: actors[1],
    serviceInstanceId: applications[app],
    submissionId: randomUUID(),
    backendType: app === 1 ? 'langchain' : 'dify',
    targetFingerprint: submissionHash([
      applications[app],
      'https://example.invalid',
      app === 1 ? 'agent' : `${marker}-${app}`,
    ]),
    credentialVersion,
    request: { content: 'Synthetic governance question' },
  });
}

async function admit(task: string, app = 0, client?: PoolClient) {
  const operation = (connection: PoolClient) =>
    admitSubmission(connection, task, actors[1], applications[app], {
      userLimit: 5,
      appLimit: 5,
    });
  return client ? operation(client) : submissionStorage(operation);
}

async function pending(
  app = 0,
  outcome: 'reserved' | 'accepted' | 'unknown' = 'reserved'
) {
  const entry = await register(app);
  await admit(entry.task.root_task_id, app);
  await markSubmissionSubmitting(entry.task.root_task_id);
  if (outcome !== 'reserved') {
    await confirmSubmission(entry.task.root_task_id, 'accepted');
    if (outcome === 'unknown')
      await confirmSubmission(entry.task.root_task_id, 'unknown');
  }
  return entry.task.root_task_id;
}

beforeAll(async () => {
  const url = resolveTestDatabaseUrl();
  database = new Pool({ connectionString: url });
  await database.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  await database.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await database.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}`
  );
  await database.query(
    `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`
  );
  for (const [index, id] of actors.entries()) {
    await database.query(
      'INSERT INTO auth_users(id,name,email) VALUES($1,$2,$3)',
      [id, marker, `${id}@example.invalid`]
    );
    await database.query(
      "INSERT INTO profiles(id,email,role,status) VALUES($1,$2,$3,'active')",
      [id, `${id}@example.invalid`, index === 0 ? 'admin' : 'user']
    );
    await database.query(
      "INSERT INTO auth_sessions(user_id,token,expires_at) VALUES($1,$2,NOW()+interval '1 hour')",
      [id, tokens[index]]
    );
  }
  for (const id of providers) {
    await database.query(
      "INSERT INTO providers(id,name,type,base_url,auth_type) VALUES($1,$2,'dify','https://example.invalid','bearer')",
      [id, `${marker}-${id}`]
    );
  }
  for (const [index, id] of applications.entries()) {
    await database.query(
      'INSERT INTO service_instances(id,provider_id,instance_id,visibility,config) VALUES($1,$2,$3,$4,$5)',
      [
        id,
        providers[0],
        `${marker}-${index}`,
        index === 0 ? 'group_only' : 'public',
        index === 1
          ? { backend_type: 'langchain', langchain: { assistant_id: 'agent' } }
          : {},
      ]
    );
  }
  await database.query('INSERT INTO groups(id,name) VALUES($1,$2)', [
    group,
    marker,
  ]);
  for (const id of actors)
    await database.query(
      'INSERT INTO group_members(group_id,user_id) VALUES($1,$2)',
      [group, id]
    );
  const scoped = new URL(url);
  scoped.searchParams.set(
    'options',
    `-c role=${role} -c app.rls_strict_mode=on`
  );
  process.env.DATABASE_URL = scoped.toString();
  process.env.APP_RLS_STRICT_MODE = 'true';
  process.env.API_ENCRYPTION_KEY = 'synthetic-credential-governance-master-key';
  delete (globalThis as Record<string, unknown>)
    .__agentifui_fastify_session_resolver_cache__;
  for (let index = 0; index < 2; index++) {
    const server = await createApiServer(config);
    origins.push(await server.listen({ host: '127.0.0.1', port: 0 }));
    servers.push(server);
  }
});

beforeEach(async () => {
  await database.query(
    'DELETE FROM agent_submissions WHERE user_id=ANY($1::uuid[])',
    [actors]
  );
  await database.query(
    'DELETE FROM api_keys WHERE provider_id=ANY($1::uuid[])',
    [providers]
  );
  await database.query(
    'UPDATE providers SET is_active=TRUE WHERE id=ANY($1::uuid[])',
    [providers]
  );
  await database.query(
    'INSERT INTO group_app_permissions(id,group_id,service_instance_id,usage_quota) VALUES($1,$2,$3,10) ON CONFLICT(id) DO UPDATE SET used_count=0,is_enabled=TRUE,usage_quota=10',
    [permission, group, applications[0]]
  );
  const fixtures = [
    [keys[0], applications[0], true, '2020-01-01'],
    [keys[1], applications[0], true, '2021-01-01'],
    [keys[2], applications[0], false, '2019-01-01'],
    [keys[3], applications[1], true, '2020-01-01'],
    [keys[4], null, true, '2018-01-01'],
  ];
  for (const [id, app, isDefault, createdAt] of fixtures) {
    await database.query(
      'INSERT INTO api_keys(id,provider_id,service_instance_id,key_value,is_default,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [id, providers[0], app, `synthetic-${id}`, isDefault, createdAt]
    );
  }
});

afterAll(async () => {
  await Promise.all(servers.map(server => server.close()));
  const state = globalThis as Record<string, unknown>;
  if (state.__agentifui_fastify_pg_pool__) await getPgPool().end();
  delete state.__agentifui_fastify_pg_pool__;
  delete state.__agentifui_fastify_session_resolver_cache__;
  if (database) {
    await database.query(`DROP TRIGGER IF EXISTS ${gate} ON api_keys`);
    await database.query(`DROP FUNCTION IF EXISTS ${gate}()`);
    await database.query(
      'DELETE FROM agent_submissions WHERE user_id=ANY($1::uuid[])',
      [actors]
    );
    await database.query('DELETE FROM groups WHERE id=$1', [group]);
    await database.query('DELETE FROM providers WHERE id=ANY($1::uuid[])', [
      providers,
    ]);
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
  for (const key of [
    'DATABASE_URL',
    'APP_RLS_STRICT_MODE',
    'API_ENCRYPTION_KEY',
  ]) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

it.each([0, 1])(
  'blocks effective key rotation for backend %s but preserves completed-task fingerprints',
  async app => {
    const task = await pending(app, 'unknown');
    const id = keys[app === 0 ? 0 : 3];
    const before =
      app === 1 ? await resolveAgentApp(applications[app], actors[1]) : null;
    const response = await action('apiKeys.update', {
      id,
      updates: { key_value: 'synthetic-rotated' },
      isEncrypted: true,
    });
    expect(response).toMatchObject({
      status: 409,
      body: { error: 'AGENT_CONFIG_BUSY' },
    });
    await confirmSubmission(task, 'finished');
    expect(
      (
        await action('apiKeys.update', {
          id,
          updates: { key_value: 'synthetic-rotated' },
          isEncrypted: true,
        })
      ).status
    ).toBe(200);
    if (before) {
      const after = await resolveAgentApp(applications[app], actors[1]);
      expect(after.fingerprint).toBe(before.fingerprint);
      expect(after.credentialVersion).not.toBe(before.credentialVersion);
    }
  }
);

it('covers default promotion, deletion and both ends of ownership moves through management HTTP', async () => {
  await pending();
  for (const [id, updates] of [
    [keys[0], { is_default: false }],
    [keys[2], { is_default: true }],
    [keys[0], { service_instance_id: applications[2] }],
    [keys[4], { service_instance_id: applications[0] }],
    [keys[0], { provider_id: providers[1] }],
    [keys[0], { user_id: actors[0] }],
  ] as const) {
    expect(await action('apiKeys.update', { id, updates })).toMatchObject({
      status: 409,
      body: { error: 'AGENT_CONFIG_BUSY' },
    });
  }
  expect((await action('apiKeys.delete', { id: keys[0] })).status).toBe(409);
  expect(
    (
      await database.query(
        'SELECT service_instance_id FROM api_keys WHERE id=$1',
        [keys[4]]
      )
    ).rows[0].service_instance_id
  ).toBeNull();
});

it('guards effective default creation and backdated SQL insertion, without blocking non-effective defaults', async () => {
  await database.query('UPDATE api_keys SET is_default=FALSE WHERE id=$1', [
    keys[1],
  ]);
  await database.query('UPDATE api_keys SET created_at=NULL WHERE id=$1', [
    keys[0],
  ]);
  await pending();
  expect(
    await action('apiKeys.create', {
      apiKey: {
        provider_id: providers[0],
        service_instance_id: applications[0],
        is_default: true,
        key_value: 'synthetic-new-default',
      },
      isEncrypted: true,
    })
  ).toMatchObject({ status: 409, body: { error: 'AGENT_CONFIG_BUSY' } });
  await expect(
    database.query(
      "INSERT INTO api_keys(provider_id,service_instance_id,key_value,is_default,created_at) VALUES($1,$2,'synthetic-backdated',TRUE,'2010-01-01')",
      [providers[0], applications[0]]
    )
  ).rejects.toMatchObject({ code: '23514', message: 'AGENT_CONFIG_BUSY' });
  expect(
    (
      await action('apiKeys.create', {
        apiKey: {
          provider_id: providers[0],
          service_instance_id: applications[0],
          is_default: false,
          key_value: 'synthetic-spare',
        },
        isEncrypted: true,
      })
    ).status
  ).toBe(200);
});

it('permits unused credential/default edits and usage metadata while preserving the effective version', async () => {
  await pending();
  const before = (await resolveDifyConfig(`${marker}-0`, {
    actorUserId: actors[1],
  }))!;
  expect(
    (
      await action('apiKeys.update', {
        id: keys[0],
        updates: { usage_count: 9, last_used_at: '2026-01-01T00:00:00Z' },
      })
    ).status
  ).toBe(200);
  expect(
    (
      await action('apiKeys.update', {
        id: keys[1],
        updates: { key_value: 'synthetic-unused' },
        isEncrypted: true,
      })
    ).status
  ).toBe(200);
  expect((await action('apiKeys.delete', { id: keys[2] })).status).toBe(200);
  expect(
    (
      await action('apiKeys.update', {
        id: keys[4],
        updates: { key_value: 'synthetic-provider-only' },
        isEncrypted: true,
      })
    ).status
  ).toBe(200);
  expect(
    (
      await action('apiKeys.create', {
        apiKey: {
          provider_id: providers[0],
          service_instance_id: applications[0],
          is_default: true,
          key_value: 'synthetic-later-default',
        },
        isEncrypted: true,
      })
    ).status
  ).toBe(200);
  expect(
    (await resolveDifyConfig(`${marker}-0`, { actorUserId: actors[1] }))!
      .credentialVersion
  ).toBe(before.credentialVersion);
  await database.query(
    'UPDATE api_keys SET credential_version=gen_random_uuid() WHERE id=$1',
    [keys[0]]
  );
  expect(
    (await resolveDifyConfig(`${marker}-0`, { actorUserId: actors[1] }))!
      .credentialVersion
  ).toBe(before.credentialVersion);
});

it('uses the same deterministic selection for tied defaults without provider fallback', async () => {
  await database.query(
    'UPDATE api_keys SET created_at=$2 WHERE id=ANY($1::uuid[])',
    [[keys[0], keys[1]], '2020-01-01']
  );
  const expected = (
    await database.query(
      'SELECT credential_version::text FROM api_keys WHERE id=ANY($1::uuid[]) ORDER BY id LIMIT 1',
      [[keys[0], keys[1]]]
    )
  ).rows[0].credential_version;
  const resolved = await resolveDifyConfig(`${marker}-0`, {
    actorUserId: actors[1],
  });
  expect(resolved!.credentialVersion).toBe(expected);
  expect(
    await resolveDifyConfig(`${marker}-2`, { actorUserId: actors[1] })
  ).toBeNull();
  const entry = await register();
  await expect(admit(entry.task.root_task_id)).resolves.toBeUndefined();
});

it('rejects stale resolved credentials at admission even if rotation predates registration', async () => {
  const resolved = (await resolveDifyConfig(`${marker}-0`, {
    actorUserId: actors[1],
  }))!;
  expect(
    (
      await action('apiKeys.update', {
        id: keys[0],
        updates: { key_value: 'synthetic-gap-rotation' },
        isEncrypted: true,
      })
    ).status
  ).toBe(200);
  const entry = await register(0, resolved.credentialVersion);
  await expect(admit(entry.task.root_task_id)).rejects.toMatchObject({
    statusCode: 409,
    code: 'AGENT_CONFIG_CHANGED',
  });
  expect(
    (
      await database.query(
        'SELECT state,quota_state FROM agent_submissions WHERE root_task_id=$1',
        [entry.task.root_task_id]
      )
    ).rows[0]
  ).toMatchObject({ state: 'registered', quota_state: 'none' });
  expect(
    (
      await database.query(
        'SELECT used_count FROM group_app_permissions WHERE id=$1',
        [permission]
      )
    ).rows[0].used_count
  ).toBe(0);
});

it('fails closed if a configured admission caller omits its credential version', async () => {
  const entry = await registerSubmission({
    userId: actors[1],
    serviceInstanceId: applications[0],
    submissionId: randomUUID(),
    backendType: 'dify',
    targetFingerprint: submissionHash([
      applications[0],
      'https://example.invalid',
      `${marker}-0`,
    ]),
    request: { content: 'Synthetic missing token' },
  });
  await expect(admit(entry.task.root_task_id)).rejects.toMatchObject({
    code: 'AGENT_CONFIG_CHANGED',
  });
});

it('rejects HTTP credential mutation against actual uncommitted admission on another connection', async () => {
  const entry = await register();
  const admission = await database.connect();
  try {
    await admission.query('BEGIN');
    await admit(entry.task.root_task_id, 0, admission);
    expect(
      await action(
        'apiKeys.update',
        { id: keys[0], updates: { is_default: false } },
        0,
        1
      )
    ).toMatchObject({ status: 409, body: { error: 'AGENT_CONFIG_BUSY' } });
    await admission.query('COMMIT');
  } finally {
    await admission.query('ROLLBACK');
    admission.release();
  }
});

it('serializes a real HTTP rotation that wins the app lock before admission, then rejects the stale token', async () => {
  const entry = await register();
  const blocker = await database.connect();
  const admission = await database.connect();
  let rotating: ReturnType<typeof action> | undefined;
  let admitting: Promise<unknown> | undefined;
  try {
    await database.query(
      `CREATE FUNCTION ${gate}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${keys[0]}'::uuid THEN PERFORM pg_advisory_xact_lock(hashtextextended('${gate}',0)); END IF; RETURN NEW; END $$`
    );
    await database.query(
      `CREATE TRIGGER ${gate} AFTER UPDATE ON api_keys FOR EACH ROW EXECUTE FUNCTION ${gate}()`
    );
    await blocker.query('BEGIN');
    await blocker.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [gate]
    );
    rotating = action(
      'apiKeys.update',
      {
        id: keys[0],
        updates: { key_value: 'synthetic-racing-rotation' },
        isEncrypted: true,
      },
      0,
      1
    );
    await waitFor(
      async () =>
        (
          await database.query(
            "SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE '%UPDATE api_keys%' AND pid<>pg_backend_pid()"
          )
        ).rowCount !== 0
    );
    await admission.query('BEGIN');
    await admission.query("SET LOCAL lock_timeout='5s'");
    const pid = (await admission.query('SELECT pg_backend_pid() AS pid'))
      .rows[0].pid;
    admitting = admit(entry.task.root_task_id, 0, admission).then(
      () => null,
      error => error
    );
    await waitFor(
      async () =>
        (
          await database.query(
            "SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event='advisory'",
            [pid]
          )
        ).rowCount !== 0
    );
    await blocker.query('COMMIT');
    expect((await rotating).status).toBe(200);
    expect(await admitting).toMatchObject({ code: 'AGENT_CONFIG_CHANGED' });
  } finally {
    await blocker.query('ROLLBACK');
    await rotating;
    await admitting;
    await admission.query('ROLLBACK');
    await database.query(`DROP TRIGGER IF EXISTS ${gate} ON api_keys`);
    await database.query(`DROP FUNCTION IF EXISTS ${gate}()`);
    blocker.release();
    admission.release();
  }
});

it('rejects HTTP quota deletion after waiting for real uncommitted admission, preserving its reservation', async () => {
  const entry = await register();
  const admission = await database.connect();
  let deleting: ReturnType<typeof action> | undefined;
  try {
    await admission.query('BEGIN');
    await admit(entry.task.root_task_id, 0, admission);
    deleting = action(
      'groups.removeGroupAppPermission',
      { groupId: group, serviceInstanceId: applications[0] },
      0,
      1
    );
    await waitFor(
      async () =>
        (
          await database.query(
            "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%DELETE FROM group_app_permissions%' AND pid<>pg_backend_pid()"
          )
        ).rowCount !== 0
    );
    await admission.query('COMMIT');
    expect(await deleting).toMatchObject({
      status: 409,
      body: { error: 'AGENT_QUOTA_BUSY' },
    });
    expect(
      (
        await database.query(
          'SELECT quota_permission_id,quota_state FROM agent_submissions WHERE root_task_id=$1',
          [entry.task.root_task_id]
        )
      ).rows[0]
    ).toEqual({ quota_permission_id: permission, quota_state: 'reserved' });
    await confirmSubmission(entry.task.root_task_id, 'finished');
    expect(
      (
        await database.query(
          'SELECT used_count FROM group_app_permissions WHERE id=$1',
          [permission]
        )
      ).rows[0].used_count
    ).toBe(1);
  } finally {
    await admission.query('ROLLBACK');
    await deleting;
    admission.release();
  }
});

it.each(['accepted', 'unknown'] as const)(
  'rejects counted %s HTTP quota deletion without waiting for the confirmer task lock',
  async outcome => {
    const task = await pending(0, outcome);
    const confirmer = await database.connect();
    try {
      await confirmer.query('BEGIN');
      await confirmer.query(
        'SELECT root_task_id FROM agent_submissions WHERE root_task_id=$1 FOR UPDATE',
        [task]
      );
      expect(
        await action(
          'groups.removeGroupAppPermission',
          { groupId: group, serviceInstanceId: applications[0] },
          0,
          1
        )
      ).toMatchObject({ status: 409, body: { error: 'AGENT_QUOTA_BUSY' } });
    } finally {
      await confirmer.query('ROLLBACK');
      confirmer.release();
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
  }
);

it.each(['reserved', 'accepted', 'unknown'] as const)(
  'preserves %s quota association under HTTP deletion and allows immediate soft disable',
  async outcome => {
    const task = await pending(0, outcome);
    expect(
      await action('groups.removeGroupAppPermission', {
        groupId: group,
        serviceInstanceId: applications[0],
      })
    ).toMatchObject({ status: 409, body: { error: 'AGENT_QUOTA_BUSY' } });
    expect(
      await action('groups.removeAllGroupAppPermissions', {
        serviceInstanceId: applications[0],
      })
    ).toMatchObject({ status: 409, body: { error: 'AGENT_QUOTA_BUSY' } });
    const disabled = await action('groups.setGroupAppPermission', {
      groupId: group,
      serviceInstanceId: applications[0],
      data: { is_enabled: false },
    });
    expect(disabled).toMatchObject({
      status: 200,
      body: {
        data: {
          id: permission,
          is_enabled: false,
          used_count: outcome === 'reserved' ? 0 : 1,
        },
      },
    });
    expect(
      (
        await database.query(
          'SELECT quota_permission_id FROM agent_submissions WHERE root_task_id=$1',
          [task]
        )
      ).rows[0].quota_permission_id
    ).toBe(permission);
    const newEntry = await registerSubmission({
      userId: actors[1],
      serviceInstanceId: applications[0],
      submissionId: randomUUID(),
      backendType: 'dify',
      credentialVersion: (
        await database.query(
          'SELECT credential_version::text FROM api_keys WHERE id=$1',
          [keys[0]]
        )
      ).rows[0].credential_version,
      targetFingerprint: submissionHash([
        applications[0],
        'https://example.invalid',
        `${marker}-0`,
      ]),
      request: { content: 'Synthetic revoked request' },
    });
    await expect(admit(newEntry.task.root_task_id)).rejects.toMatchObject({
      code: 'AGENT_APP_FORBIDDEN',
    });
    await confirmSubmission(task, 'finished');
    expect(
      (
        await action('groups.removeGroupAppPermission', {
          groupId: group,
          serviceInstanceId: applications[0],
        })
      ).status
    ).toBe(200);
  }
);

it('preserves emergency provider disable and denies non-admin key management', async () => {
  await pending(0, 'unknown');
  expect(
    (
      await action('providers.updateProvider', {
        id: providers[0],
        updates: { is_active: false },
      })
    ).status
  ).toBe(200);
  expect(
    (
      await database.query('SELECT is_active FROM providers WHERE id=$1', [
        providers[0],
      ])
    ).rows[0].is_active
  ).toBe(false);
  expect((await action('apiKeys.delete', { id: keys[0] }, 1)).status).toBe(403);
});

it('does not classify unrelated constraint errors as a pending-work conflict', async () => {
  const response = await action('apiKeys.create', {
    apiKey: { provider_id: randomUUID(), key_value: 'synthetic-invalid-owner' },
    isEncrypted: true,
  });
  expect(response.status).toBe(500);
  expect(response.body.error).not.toBe('AGENT_CONFIG_BUSY');
  expect(response.body.error).not.toBe('AGENT_QUOTA_BUSY');
});

it('restores restricted caller context after successful and rejected credential and quota trigger exits', async () => {
  await pending(0, 'accepted');
  const administrator = await database.connect();
  try {
    await administrator.query('BEGIN');
    await administrator.query(`SET LOCAL ROLE ${role}`);
    await administrator.query(
      "SELECT set_config('app.rls_system_actor','false',true),set_config('app.current_user_role','admin',true),set_config('app.current_user_id',$1,true),set_config('app.rls_strict_mode','true',true)",
      [actors[0]]
    );
    await administrator.query(
      'UPDATE api_keys SET usage_count=usage_count+1 WHERE id=$1',
      [keys[0]]
    );
    await administrator.query(
      'UPDATE group_app_permissions SET is_enabled=FALSE WHERE id=$1',
      [permission]
    );
    for (const sql of [
      "UPDATE api_keys SET key_value='synthetic-denied' WHERE id=$1",
      'DELETE FROM group_app_permissions WHERE id=$1',
    ]) {
      await administrator.query('SAVEPOINT denied');
      await expect(
        administrator.query(sql, [
          sql.startsWith('DELETE') ? permission : keys[0],
        ])
      ).rejects.toMatchObject({ code: '23514' });
      await administrator.query('ROLLBACK TO SAVEPOINT denied');
      expect(
        (
          await administrator.query(
            "SELECT current_setting('app.rls_system_actor') AS context"
          )
        ).rows[0].context
      ).toBe('false');
      expect(
        (
          await administrator.query(
            'SELECT root_task_id FROM agent_submissions'
          )
        ).rows
      ).toHaveLength(0);
    }
    expect(
      (
        await administrator.query(
          'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user'
        )
      ).rows[0]
    ).toEqual({ rolsuper: false, rolbypassrls: false });
  } finally {
    await administrator.query('ROLLBACK');
    administrator.release();
  }
});
