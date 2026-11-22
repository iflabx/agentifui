/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import type { ApiRuntimeConfig } from '../../apps/api/src/config';
import { runAuditedAdminMutation } from '../../apps/api/src/lib/admin-audit';
import { resolveDifyConfig } from '../../apps/api/src/lib/dify-config';
import {
  clearDifyInputCapabilitiesCache,
  resolveDifyInputCapabilities,
} from '../../apps/api/src/lib/dify-input-capabilities';
import {
  canReadDifyUpload,
  hasDifyUploadReference,
  loadDifyUploadMetadata,
  registerDifyUpload,
} from '../../apps/api/src/lib/dify-upload-access';
import {
  getPgPool,
  queryRowsWithPgSystemContext,
} from '../../apps/api/src/lib/pg-context';
import { listTaskOperations } from '../../apps/api/src/lib/task-operations';
import {
  toErrorResponse,
  toSuccessResponse,
} from '../../apps/api/src/routes/internal-data-route/helpers';
import { createApiServer } from '../../apps/api/src/server';
import { resolveTestDatabaseUrl } from './helpers/test-database-url';
import { createTestRole, dropTestRole } from './helpers/test-role';

jest.mock('../../apps/api/src/lib/error-events', () => ({
  recordApiErrorEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.setTimeout(30000);
const original = { ...process.env };
const actor = randomUUID(),
  user = randomUUID(),
  provider = randomUUID(),
  appId = randomUUID();
const actorToken = randomUUID(),
  userToken = randomUUID();
const marker = `gov-${randomUUID()}`;
const role = `gov_${randomUUID().replaceAll('-', '')}`;
let database: Pool;
let server: Awaited<ReturnType<typeof createApiServer>>;
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
function call(
  action: string,
  payload: Record<string, unknown>,
  token = actorToken,
  headers: Record<string, string> = {}
) {
  return server.inject({
    method: 'POST',
    url: '/api/internal/data',
    headers: { cookie: `session_token=${token}`, ...headers },
    payload: { action, payload },
  });
}
beforeAll(async () => {
  const url = resolveTestDatabaseUrl();
  const databaseName = new URL(url).pathname;
  if (
    !databaseName.startsWith('/gov_verify_') &&
    databaseName !== '/agentifui_test'
  )
    throw new Error(
      'Governance integration requires a dedicated gov_verify_ database'
    );
  database = new Pool({ connectionString: url });
  await createTestRole(database, role);
  for (const [id, accountRole, token] of [
    [actor, 'admin', actorToken],
    [user, 'user', userToken],
  ]) {
    await database.query(
      'INSERT INTO auth_users(id,name,email) VALUES($1,$2,$3)',
      [id, marker, `${id}@example.invalid`]
    );
    await database.query(
      "INSERT INTO profiles(id,email,role,status) VALUES($1,$2,$3,'active')",
      [id, `${id}@example.invalid`, accountRole]
    );
    await database.query(
      "INSERT INTO auth_sessions(user_id,token,expires_at) VALUES($1,$2,NOW()+interval '1 hour')",
      [id, token]
    );
  }
  await database.query(
    "INSERT INTO providers(id,name,type,base_url,auth_type) VALUES($1,$2,'dify','https://upstream.example.invalid','bearer')",
    [provider, marker]
  );
  await database.query(
    "INSERT INTO service_instances(id,provider_id,instance_id,visibility,config) VALUES($1,$2,$3,'public','{}')",
    [appId, provider, marker]
  );
  const scoped = new URL(url);
  scoped.searchParams.set(
    'options',
    `-c role=${role} -c app.rls_strict_mode=on`
  );
  process.env.DATABASE_URL = scoped.toString();
  process.env.APP_RLS_STRICT_MODE = 'true';
  process.env.API_ENCRYPTION_KEY = 'synthetic-governance-master';
  server = await createApiServer(config);
});
beforeEach(async () => {
  await database.query(
    "UPDATE profiles SET role=CASE WHEN id=$1::uuid THEN 'admin'::user_role ELSE 'user'::user_role END,status='active' WHERE id=ANY($2::uuid[])",
    [actor, [actor, user]]
  );
});
afterAll(async () => {
  await server.close();
  const state = globalThis as Record<string, unknown>;
  if (state.__agentifui_fastify_pg_pool__) {
    await getPgPool().end();
    delete state.__agentifui_fastify_pg_pool__;
  }
  if (database) {
    await database.query(
      'DELETE FROM agent_submissions WHERE user_id=ANY($1::uuid[])',
      [[actor, user]]
    );
    await database.query(
      'DELETE FROM conversations WHERE user_id=ANY($1::uuid[])',
      [[actor, user]]
    );
    await database.query(
      'DELETE FROM app_executions WHERE user_id=ANY($1::uuid[])',
      [[actor, user]]
    );
    await database.query('DELETE FROM service_instances WHERE id=$1', [appId]);
    await database.query('DELETE FROM providers WHERE id=$1', [provider]);
    await database.query('DELETE FROM profiles WHERE id=ANY($1::uuid[])', [
      [actor, user],
    ]);
    await database.query('DELETE FROM auth_users WHERE id=ANY($1::uuid[])', [
      [actor, user],
    ]);
    await dropTestRole(database, role);
    await database.end();
  }
  process.env = original;
});

test('management changes commit with safe before/after audit, and audit reads are admin-only', async () => {
  const response = await call('users.updateUserProfile', {
    userId: user,
    updates: { role: 'manager' },
    actorUserId: user,
    secret: 'synthetic-not-to-store',
  });
  expect(response.statusCode).toBe(200);
  const operation = response.json().operationId;
  const result = await database.query(
    'SELECT * FROM admin_audit_events WHERE operation_id=$1',
    [operation]
  );
  expect(result.rows[0]).toMatchObject({
    actor_user_id: actor,
    outcome: 'committed',
    changes: {
      changed: true,
      before: [{ id: user, role: 'user' }],
      after: [{ id: user, role: 'manager' }],
    },
  });
  expect(JSON.stringify(result.rows)).not.toContain('synthetic-not-to-store');
  expect(
    (await call('audit.getRecent', { operationId: operation })).json().data
  ).toHaveLength(1);
  expect((await call('audit.getRecent', {}, userToken)).statusCode).toBe(403);
});

test('authorization SQL times out on a real table lock and releases its connection', async () => {
  const blocker = await database.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE conversations IN ACCESS EXCLUSIVE MODE');
    await expect(
      queryRowsWithPgSystemContext('SELECT id FROM conversations LIMIT 1', [], {
        statementTimeoutMs: 50,
      })
    ).rejects.toMatchObject({ code: '57014' });
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  expect(await queryRowsWithPgSystemContext('SELECT 1 AS available')).toEqual([
    { available: 1 },
  ]);
});

test('returned business errors roll back all writes; no successful audit is invented', async () => {
  const response = await runAuditedAdminMutation(
    {
      action: 'users.updateUserProfile',
      payload: { userId: user },
      actorUserId: actor,
      tokens: [actorToken],
      requestId: randomUUID(),
    },
    async client => {
      await client.query("UPDATE profiles SET role='manager' WHERE id=$1", [
        user,
      ]);
      return toErrorResponse('Synthetic second-step rejection', 400);
    }
  );
  expect(response.statusCode).toBe(400);
  expect(
    (await database.query('SELECT role FROM profiles WHERE id=$1', [user]))
      .rows[0].role
  ).toBe('user');
});

test('audit insert failure rolls back a successful business update', async () => {
  const requestId = randomUUID();
  await database.query(`CREATE FUNCTION gov_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${requestId}' THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER gov_fail_audit BEFORE INSERT ON admin_audit_events FOR EACH ROW EXECUTE FUNCTION gov_fail_audit()`);
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const response = await runAuditedAdminMutation(
      {
        action: 'users.updateUserProfile',
        payload: { userId: user },
        actorUserId: actor,
        tokens: [actorToken],
        requestId,
      },
      async client => {
        await client.query("UPDATE profiles SET role='manager' WHERE id=$1", [
          user,
        ]);
        return toSuccessResponse(null);
      }
    );
    expect(response.statusCode).toBe(503);
    expect(
      (await database.query('SELECT role FROM profiles WHERE id=$1', [user]))
        .rows[0].role
    ).toBe('user');
  } finally {
    warning.mockRestore();
    await database.query(
      'DROP TRIGGER gov_fail_audit ON admin_audit_events;DROP FUNCTION gov_fail_audit()'
    );
  }
});

test('strict runtime users cannot read, modify, or delete append-only audit records', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE "${role}"`);
    await client.query(
      "SELECT set_config('app.rls_system_actor','false',true),set_config('app.current_user_id',$1,true)",
      [user]
    );
    expect(
      (await client.query('SELECT * FROM admin_audit_events')).rows
    ).toHaveLength(0);
    expect(
      (
        await client.query(
          "UPDATE admin_audit_events SET reason_code='tampered'"
        )
      ).rowCount
    ).toBe(0);
    expect(
      (await client.query('DELETE FROM admin_audit_events')).rowCount
    ).toBe(0);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

test('forged actor, expired actor session, and cross-site mutations are rejected', async () => {
  expect(
    (
      await call(
        'users.updateUserProfile',
        { userId: actor, updates: { role: 'user' }, actorUserId: actor },
        userToken
      )
    ).statusCode
  ).toBe(403);
  expect(
    (
      await call('users.revokeAllSessions', { userId: user }, actorToken, {
        origin: 'https://foreign.example.invalid',
      })
    ).statusCode
  ).toBe(403);
  const response = await runAuditedAdminMutation(
    {
      action: 'users.updateUserProfile',
      payload: { userId: user },
      actorUserId: actor,
      tokens: [randomUUID()],
      requestId: randomUUID(),
    },
    async () => toSuccessResponse(null)
  );
  expect(response.statusCode).toBe(403);
});

test('revokes actual existing sessions, is a repeatable no-op, and leaves other accounts intact', async () => {
  const response = await call('users.revokeAllSessions', { userId: user });
  expect(response.statusCode).toBe(200);
  expect(response.json().data.revokedCount).toBe(1);
  expect(
    (
      await database.query('SELECT token FROM auth_sessions WHERE user_id=$1', [
        user,
      ])
    ).rows
  ).toHaveLength(0);
  expect(
    (await call('users.revokeAllSessions', { userId: user })).json().data
      .revokedCount
  ).toBe(0);
  expect(
    (await call('groups.getUserAccessibleApps', {}, userToken)).statusCode
  ).toBe(401);
  expect(
    (
      await database.query('SELECT token FROM auth_sessions WHERE user_id=$1', [
        actor,
      ])
    ).rows
  ).toHaveLength(1);
  await database.query(
    "INSERT INTO auth_sessions(user_id,token,expires_at) VALUES($1,$2,NOW()+interval '1 hour')",
    [user, userToken]
  );
});

test('upload access distinguishes staged uploads, deleted history, valid shared references and explicit deleted contexts', async () => {
  const fileId = randomUUID(),
    conversationId = randomUUID(),
    second = randomUUID();
  const scope = { userId: user, serviceInstanceId: appId, fileId };
  await registerDifyUpload(scope);
  expect(await canReadDifyUpload(scope)).toBe(true);
  for (const id of [conversationId, second]) {
    await database.query(
      "INSERT INTO conversations(id,user_id,title,app_id) VALUES($1,$2,'synthetic',$3)",
      [id, user, appId]
    );
    await database.query(
      "INSERT INTO messages(conversation_id,user_id,role,content,metadata) VALUES($1,$2,'user','synthetic',$3)",
      [id, user, { attachments: [{ upload_file_id: fileId }] }]
    );
  }
  await database.query(
    "UPDATE conversations SET status='deleted' WHERE id=$1",
    [conversationId]
  );
  expect(await canReadDifyUpload(scope)).toBe(true);
  expect(await canReadDifyUpload(scope, { conversationId })).toBe(false);
  await database.query(
    "UPDATE conversations SET status='deleted' WHERE id=$1",
    [second]
  );
  expect(await canReadDifyUpload(scope)).toBe(false);
  expect(await canReadDifyUpload({ ...scope, userId: actor })).toBe(false);
  const forged = randomUUID();
  await database.query(
    "INSERT INTO conversations(id,user_id,title,app_id) VALUES($1,$2,'synthetic',$3)",
    [forged, actor, appId]
  );
  await database.query(
    "INSERT INTO messages(conversation_id,user_id,role,content,metadata) VALUES($1,$2,'user','synthetic',$3)",
    [forged, actor, { attachments: [{ upload_file_id: fileId }] }]
  );
  expect(await canReadDifyUpload({ ...scope, userId: actor })).toBe(false);
  const execution = randomUUID(),
    workflowFile = randomUUID();
  await registerDifyUpload({ ...scope, fileId: workflowFile });
  await database.query(
    "INSERT INTO app_executions(id,user_id,service_instance_id,execution_type,title,inputs) VALUES($1,$2,$3,'workflow','synthetic',$4)",
    [execution, user, appId, { file: { upload_file_id: workflowFile } }]
  );
  expect(await canReadDifyUpload({ ...scope, fileId: workflowFile })).toBe(
    true
  );
  await database.query(
    "UPDATE app_executions SET status='deleted' WHERE id=$1",
    [execution]
  );
  expect(await canReadDifyUpload({ ...scope, fileId: workflowFile })).toBe(
    false
  );
});

test('legacy references alone grant no ownership, while trusted registration remains bound after deletion', async () => {
  const fileId = randomUUID();
  const ownerConversation = randomUUID();
  const forgedConversation = randomUUID();
  const scope = { userId: user, serviceInstanceId: appId, fileId };
  for (const [conversationId, userId] of [
    [ownerConversation, user],
    [forgedConversation, actor],
  ]) {
    await database.query(
      "INSERT INTO conversations(id,user_id,title,app_id) VALUES($1,$2,'Synthetic legacy history',$3)",
      [conversationId, userId, appId]
    );
    await database.query(
      "INSERT INTO messages(conversation_id,user_id,role,content,metadata) VALUES($1,$2,'user','Synthetic legacy reference',$3)",
      [conversationId, userId, { attachments: [{ upload_file_id: fileId }] }]
    );
  }
  expect(await hasDifyUploadReference(scope)).toBe(true);
  expect(await canReadDifyUpload(scope)).toBe(false);
  await registerDifyUpload(scope, true);
  expect(await canReadDifyUpload(scope)).toBe(true);
  expect(await hasDifyUploadReference({ ...scope, userId: actor })).toBe(true);
  expect(await canReadDifyUpload({ ...scope, userId: actor })).toBe(false);
  await database.query(
    "UPDATE conversations SET status='deleted' WHERE id=$1",
    [ownerConversation]
  );
  expect(await canReadDifyUpload(scope)).toBe(false);
  expect(await hasDifyUploadReference(scope)).toBe(false);
  await registerDifyUpload(scope);
  expect(await canReadDifyUpload(scope)).toBe(false);
});

test('upload metadata is trusted-registration scoped, nullable for old history and immutable on re-registration', async () => {
  const scope = {
    userId: user,
    serviceInstanceId: appId,
    fileId: randomUUID(),
  };
  await registerDifyUpload(scope);
  expect(await loadDifyUploadMetadata(scope)).toBeNull();
  const metadata = { name: 'source.txt', size: 12, type: 'text/plain' };
  await registerDifyUpload(scope, false, metadata);
  expect(await loadDifyUploadMetadata(scope)).toEqual(metadata);
  await registerDifyUpload(scope, false, {
    name: 'forged.txt',
    size: 1,
    type: 'image/png',
  });
  expect(await loadDifyUploadMetadata(scope)).toEqual(metadata);
  expect(await loadDifyUploadMetadata({ ...scope, userId: actor })).toBeNull();
  expect(
    await loadDifyUploadMetadata({ ...scope, serviceInstanceId: randomUUID() })
  ).toBeNull();
  await database.query("UPDATE profiles SET status='suspended' WHERE id=$1", [
    user,
  ]);
  expect(await loadDifyUploadMetadata(scope)).toBeNull();
});

test('capability configuration stays bound to the authorized UUID when provider aliases overlap', async () => {
  const secondProvider = randomUUID(),
    secondApp = randomUUID();
  try {
    await database.query(
      "INSERT INTO providers(id,name,type,base_url,auth_type) VALUES($1,$2,'dify','https://second.example.invalid/v1','bearer')",
      [secondProvider, marker + '-second']
    );
    await database.query(
      "INSERT INTO service_instances(id,provider_id,instance_id,visibility,config) VALUES($1,$2,$3,'public','{}')",
      [secondApp, secondProvider, marker]
    );
    for (const [providerId, serviceId] of [
      [provider, appId],
      [secondProvider, secondApp],
    ])
      await database.query(
        'INSERT INTO api_keys(provider_id,service_instance_id,key_value,is_default) VALUES($1,$2,$3,TRUE)',
        [providerId, serviceId, 'synthetic-input-key']
      );
    for (const serviceInstanceId of [appId, secondApp]) {
      const resolved = await resolveDifyConfig(marker, {
        actorUserId: user,
        actorRole: 'user',
        serviceInstanceId,
      });
      expect(resolved?.serviceInstanceId).toBe(serviceInstanceId);
    }
  } finally {
    await database.query(
      'DELETE FROM api_keys WHERE service_instance_id=ANY($1::uuid[])',
      [[appId, secondApp]]
    );
    await database.query('DELETE FROM service_instances WHERE id=$1', [
      secondApp,
    ]);
    await database.query('DELETE FROM providers WHERE id=$1', [secondProvider]);
  }
});

test('committed instance updates invalidate cached capabilities in the current API process', async () => {
  const originalFetch = global.fetch;
  clearDifyInputCapabilitiesCache();
  const fetchMock = jest.fn(async () => new Response('{}'));
  global.fetch = fetchMock;
  const target = {
    serviceInstanceId: appId,
    difyApiUrl: 'https://upstream.example.invalid/v1',
    difyApiKey: 'synthetic-cache',
  };
  try {
    await resolveDifyInputCapabilities(target);
    await resolveDifyInputCapabilities(target);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const response = await call('serviceInstances.update', {
      id: appId,
      updates: { display_name: 'Synthetic updated input settings' },
    });
    expect(response.statusCode).toBe(200);
    await resolveDifyInputCapabilities(target);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    global.fetch = originalFetch;
    clearDifyInputCapabilitiesCache();
  }
});

test('task lookup is safe, bounded and read-only; it preserves unknown tasks and reservations', async () => {
  const id = randomUUID();
  await database.query(
    "INSERT INTO agent_submissions(root_task_id,user_id,service_instance_id,submission_id,request_hash,target_fingerprint,backend_type,state) VALUES($1,$2,$3,$4,$5,$5,'dify','unknown')",
    [id, user, appId, randomUUID(), 'a'.repeat(64)]
  );
  const before = (
    await database.query(
      'SELECT * FROM agent_submissions WHERE root_task_id=$1',
      [id]
    )
  ).rows;
  const response = await listTaskOperations({ taskId: id }, actor);
  expect(response.statusCode).toBe(200);
  expect(JSON.stringify(response.payload)).not.toContain('target_fingerprint');
  expect(
    (response.payload as { data: { tasks: unknown[] } }).data.tasks
  ).toEqual([
    expect.objectContaining({
      task_id: id,
      state: 'unknown',
      blocking_reason: 'UPSTREAM_UNCONFIRMED',
      occupies_slot: true,
    }),
  ]);
  expect(
    (
      await database.query(
        'SELECT * FROM agent_submissions WHERE root_task_id=$1',
        [id]
      )
    ).rows
  ).toEqual(before);
  expect((await call('tasks.getRecent', {}, userToken)).statusCode).toBe(403);
  await database.query('DELETE FROM agent_submissions WHERE root_task_id=$1', [
    id,
  ]);
});
