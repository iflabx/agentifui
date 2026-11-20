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

const originalEnvironment = { ...process.env };
const actorId = randomUUID();
const targetId = randomUUID();
const actorToken = randomUUID();
const targetToken = randomUUID();
const oldProviderId = randomUUID();
const newProviderId = randomUUID();
const movingAppId = randomUUID();
const oldFallbackAppId = randomUUID();
const newFallbackAppId = randomUUID();
const appIds = [movingAppId, oldFallbackAppId, newFallbackAppId];
const marker = `gov-boundaries-${randomUUID()}`;
const runtimeRole = `gov_boundaries_${randomUUID().replaceAll('-', '')}`;
const groupIds: string[] = [];
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
    throw new Error('Governance boundary fixtures are not initialized');
  return database;
}

function call(action: string, payload: Record<string, unknown>) {
  if (!server) throw new Error('Governance boundary API is not initialized');
  return server.inject({
    method: 'POST',
    url: '/api/internal/data',
    headers: { cookie: `session_token=${actorToken}` },
    payload: { action, payload },
  });
}

async function auditFor(operationId: string) {
  expect(operationId).toEqual(expect.any(String));
  const result = await fixtureDatabase().query(
    'SELECT actor_user_id, action, outcome, changes, reason_code FROM admin_audit_events WHERE operation_id=$1::uuid',
    [operationId]
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].actor_user_id).toBe(actorId);
  return result.rows[0];
}

async function createGroup() {
  const groupId = randomUUID();
  groupIds.push(groupId);
  await fixtureDatabase().query(
    'INSERT INTO groups(id,name,created_by) VALUES($1,$2,$3)',
    [groupId, marker, actorId]
  );
  return groupId;
}

async function createGrant(groupId: string, appId: string) {
  const grantId = randomUUID();
  await fixtureDatabase().query(
    'INSERT INTO group_app_permissions(id,group_id,service_instance_id,is_enabled,usage_quota) VALUES($1,$2,$3,true,17)',
    [grantId, groupId, appId]
  );
  return grantId;
}

async function serviceState() {
  return (
    await fixtureDatabase().query(
      'SELECT id,provider_id,visibility,is_default,updated_at::text AS updated_at FROM service_instances WHERE id=ANY($1::uuid[]) ORDER BY id',
      [appIds]
    )
  ).rows;
}

beforeAll(async () => {
  const url = resolveTestDatabaseUrl();
  const databasePath = new URL(url).pathname;
  if (
    !databasePath.startsWith('/gov_verify_') &&
    databasePath !== '/agentifui_test'
  ) {
    throw new Error(
      'Governance boundaries require a dedicated gov_verify_ database or agentifui_test'
    );
  }
  database = new Pool({ connectionString: url });
  await createTestRole(database, runtimeRole);
  roleCreated = true;
  for (const [userId, accountRole, token] of [
    [actorId, 'admin', actorToken],
    [targetId, 'user', targetToken],
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
  for (const providerId of [oldProviderId, newProviderId]) {
    await database.query(
      "INSERT INTO providers(id,name,type,base_url,auth_type) VALUES($1,$2,'dify','https://upstream.example.invalid','bearer')",
      [providerId, `${marker}-${providerId}`]
    );
  }
  for (const [appId, providerId] of [
    [movingAppId, oldProviderId],
    [oldFallbackAppId, oldProviderId],
    [newFallbackAppId, newProviderId],
  ]) {
    await database.query(
      "INSERT INTO service_instances(id,provider_id,instance_id,visibility,is_default,config) VALUES($1,$2,$3,'public',false,'{}')",
      [appId, providerId, `${marker}-${appId}`]
    );
  }
  const scopedUrl = new URL(url);
  scopedUrl.searchParams.set(
    'options',
    `-c role=${runtimeRole} -c app.rls_strict_mode=on`
  );
  process.env.DATABASE_URL = scopedUrl.toString();
  process.env.APP_RLS_STRICT_MODE = 'true';
  process.env.API_ENCRYPTION_KEY = 'synthetic-governance-boundaries-master';
  server = await createApiServer(config);
});

beforeEach(async () => {
  await fixtureDatabase().query(
    "UPDATE profiles SET role=CASE WHEN id=$1::uuid THEN 'admin'::user_role ELSE 'user'::user_role END,status='active' WHERE id=ANY($2::uuid[])",
    [actorId, [actorId, targetId]]
  );
  await fixtureDatabase().query(
    'UPDATE service_instances SET is_default=false WHERE id=ANY($1::uuid[])',
    [appIds]
  );
  await fixtureDatabase().query(
    "UPDATE service_instances SET provider_id=CASE WHEN id=$1::uuid THEN $2::uuid ELSE $3::uuid END,visibility='public',is_default=(id=$4::uuid) WHERE id=ANY($5::uuid[])",
    [newFallbackAppId, newProviderId, oldProviderId, movingAppId, appIds]
  );
});

afterAll(async () => {
  try {
    if (server) await server.close();
    const state = globalThis as Record<string, unknown>;
    if (state.__agentifui_fastify_pg_pool__) {
      await getPgPool().end();
      delete state.__agentifui_fastify_pg_pool__;
    }
    if (database) {
      await database.query('DELETE FROM groups WHERE id=ANY($1::uuid[])', [
        groupIds,
      ]);
      await database.query(
        'DELETE FROM service_instances WHERE id=ANY($1::uuid[])',
        [appIds]
      );
      await database.query('DELETE FROM providers WHERE id=ANY($1::uuid[])', [
        [oldProviderId, newProviderId],
      ]);
      await database.query('DELETE FROM profiles WHERE id=ANY($1::uuid[])', [
        [actorId, targetId],
      ]);
      await database.query('DELETE FROM auth_users WHERE id=ANY($1::uuid[])', [
        [actorId, targetId],
      ]);
      if (roleCreated) await dropTestRole(database, runtimeRole);
    }
  } finally {
    if (database) await database.end();
    process.env = originalEnvironment;
  }
});

test.each([{ userIds: [] }, { userIds: [actorId] }])(
  'single-user auditing ignores unrelated userIds=$userIds',
  async ({ userIds }) => {
    const response = await call('users.updateUserProfile', {
      userId: targetId,
      userIds,
      updates: { role: 'manager' },
    });
    expect(response.statusCode).toBe(200);
    expect(await auditFor(response.json().operationId)).toMatchObject({
      action: 'users.updateUserProfile',
      outcome: 'committed',
      changes: {
        before: [{ id: targetId, role: 'user', status: 'active' }],
        after: [{ id: targetId, role: 'manager', status: 'active' }],
        changed: true,
        changedCount: 1,
      },
    });
    expect(
      (
        await fixtureDatabase().query('SELECT role FROM profiles WHERE id=$1', [
          targetId,
        ])
      ).rows[0].role
    ).toBe('manager');
    expect(
      (
        await fixtureDatabase().query('SELECT role FROM profiles WHERE id=$1', [
          actorId,
        ])
      ).rows[0].role
    ).toBe('admin');
  }
);

test('batch auditing uses userIds rather than a misleading single userId', async () => {
  const response = await call('users.batchUpdateUserRole', {
    userIds: [targetId],
    userId: actorId,
    role: 'manager',
  });
  expect(response.statusCode).toBe(200);
  expect(await auditFor(response.json().operationId)).toMatchObject({
    outcome: 'committed',
    changes: {
      before: [{ id: targetId, role: 'user', status: 'active' }],
      after: [{ id: targetId, role: 'manager', status: 'active' }],
      changedCount: 1,
    },
  });
  expect(
    (
      await fixtureDatabase().query('SELECT role FROM profiles WHERE id=$1', [
        actorId,
      ])
    ).rows[0].role
  ).toBe('admin');
});

test('remove-all permissions ignores a misleading groupId and audits every affected group', async () => {
  const firstGroupId = await createGroup();
  const secondGroupId = await createGroup();
  const firstGrantId = await createGrant(firstGroupId, movingAppId);
  const secondGrantId = await createGrant(secondGroupId, movingAppId);
  const unrelatedGrantId = await createGrant(firstGroupId, oldFallbackAppId);
  const response = await call('groups.removeAllGroupAppPermissions', {
    serviceInstanceId: movingAppId,
    groupId: firstGroupId,
  });
  expect(response.statusCode).toBe(200);
  const audit = await auditFor(response.json().operationId);
  expect(audit).toMatchObject({
    outcome: 'committed',
    changes: { after: [], changed: true, changedCount: 2 },
  });
  expect(
    audit.changes.before.map((row: { id: string }) => row.id).sort()
  ).toEqual([firstGrantId, secondGrantId].sort());
  expect(
    (
      await fixtureDatabase().query(
        'SELECT id FROM group_app_permissions WHERE group_id=ANY($1::uuid[]) ORDER BY id',
        [[firstGroupId, secondGroupId]]
      )
    ).rows
  ).toEqual([{ id: unrelatedGrantId }]);
});

test('group deletion ignores an extra app filter and snapshots the group and all cascades', async () => {
  const groupId = await createGroup();
  const firstGrantId = await createGrant(groupId, movingAppId);
  const secondGrantId = await createGrant(groupId, oldFallbackAppId);
  const memberId = randomUUID();
  await fixtureDatabase().query(
    'INSERT INTO group_members(id,group_id,user_id) VALUES($1,$2,$3)',
    [memberId, groupId, targetId]
  );
  const response = await call('groups.deleteGroup', {
    groupId,
    serviceInstanceId: movingAppId,
  });
  expect(response.statusCode).toBe(200);
  const audit = await auditFor(response.json().operationId);
  expect(audit).toMatchObject({
    outcome: 'committed',
    changes: { after: [], changed: true, changedCount: 4 },
  });
  expect(audit.changes.before).toHaveLength(4);
  expect(audit.changes.before).toEqual(
    expect.arrayContaining([
      { kind: 'group', id: groupId },
      expect.objectContaining({ kind: 'permission', id: firstGrantId }),
      expect.objectContaining({ kind: 'permission', id: secondGrantId }),
      expect.objectContaining({ kind: 'member', id: memberId }),
    ])
  );
  expect(
    (
      await fixtureDatabase().query('SELECT id FROM groups WHERE id=$1', [
        groupId,
      ])
    ).rows
  ).toEqual([]);
  expect(
    (
      await fixtureDatabase().query(
        'SELECT id FROM group_members WHERE group_id=$1',
        [groupId]
      )
    ).rows
  ).toEqual([]);
  expect(
    (
      await fixtureDatabase().query(
        'SELECT id FROM group_app_permissions WHERE group_id=$1',
        [groupId]
      )
    ).rows
  ).toEqual([]);
});

test('empty-group deletion is a change, while repeating deletion is an audited no-op', async () => {
  const groupId = await createGroup();
  const first = await call('groups.deleteGroup', { groupId });
  expect(first.statusCode).toBe(200);
  expect(await auditFor(first.json().operationId)).toMatchObject({
    outcome: 'committed',
    changes: {
      before: [{ kind: 'group', id: groupId }],
      after: [],
      changed: true,
      changedCount: 1,
    },
  });
  expect(
    (
      await fixtureDatabase().query('SELECT id FROM groups WHERE id=$1', [
        groupId,
      ])
    ).rows
  ).toEqual([]);
  const repeated = await call('groups.deleteGroup', { groupId });
  expect(repeated.statusCode).toBe(200);
  expect(repeated.json().operationId).not.toBe(first.json().operationId);
  expect(await auditFor(repeated.json().operationId)).toMatchObject({
    outcome: 'committed',
    changes: { before: [], after: [], changed: false, changedCount: 0 },
  });
});

test('real service update rolls back provider, visibility and both default repairs when audit fails', async () => {
  const before = await serviceState();
  const failureFunction = `gov_boundary_fail_${randomUUID().replaceAll('-', '')}`;
  const failureTrigger = `gov_boundary_trigger_${randomUUID().replaceAll('-', '')}`;
  const payload = {
    id: movingAppId,
    updates: {
      provider_id: newProviderId,
      visibility: 'private',
      is_default: false,
    },
  };
  await fixtureDatabase().query(`
    CREATE FUNCTION "${failureFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM service_instances WHERE id='${movingAppId}'::uuid
        AND provider_id='${newProviderId}'::uuid AND visibility='private' AND is_default=false)
        OR NOT EXISTS (SELECT 1 FROM service_instances WHERE id='${oldFallbackAppId}'::uuid AND is_default=true)
        OR NOT EXISTS (SELECT 1 FROM service_instances WHERE id='${newFallbackAppId}'::uuid AND is_default=true) THEN
        RAISE EXCEPTION 'GOVERNANCE_REPAIRS_NOT_REACHED';
      END IF;
      RAISE EXCEPTION 'GOVERNANCE_AUDIT_BOUNDARY_REACHED';
    END $$;
    CREATE TRIGGER "${failureTrigger}" BEFORE INSERT ON admin_audit_events FOR EACH ROW
      WHEN (NEW.actor_user_id='${actorId}'::uuid AND NEW.action='serviceInstances.update'
        AND NEW.target_id='${movingAppId}' AND NEW.outcome='committed')
      EXECUTE FUNCTION "${failureFunction}"();
  `);
  try {
    const response = await call('serviceInstances.update', payload);
    expect(response.statusCode).toBe(503);
    expect(await auditFor(response.json().operationId)).toMatchObject({
      action: 'serviceInstances.update',
      outcome: 'failed',
      reason_code: 'ADMIN_MUTATION_FAILED',
      changes: {},
    });
    expect(await serviceState()).toEqual(before);
  } finally {
    await fixtureDatabase().query(`
      DROP TRIGGER IF EXISTS "${failureTrigger}" ON admin_audit_events;
      DROP FUNCTION IF EXISTS "${failureFunction}"();
    `);
  }
  const success = await call('serviceInstances.update', payload);
  expect(success.statusCode).toBe(200);
  const after = await serviceState();
  expect(after).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: movingAppId,
        provider_id: newProviderId,
        visibility: 'private',
        is_default: false,
      }),
      expect.objectContaining({
        id: oldFallbackAppId,
        provider_id: oldProviderId,
        is_default: true,
      }),
      expect.objectContaining({
        id: newFallbackAppId,
        provider_id: newProviderId,
        is_default: true,
      }),
    ])
  );
  const audit = await auditFor(success.json().operationId);
  const auditState = (rows: Awaited<ReturnType<typeof serviceState>>) =>
    rows.map(({ updated_at, ...row }) => {
      expect(updated_at).toEqual(expect.any(String));
      return row;
    });
  expect(audit).toMatchObject({
    outcome: 'committed',
    changes: {
      before: auditState(before),
      after: auditState(after),
      changed: true,
      changedCount: 3,
    },
  });
});

test.each(['member target profile', 'provider sibling service'] as const)(
  'two connections reject a locked %s with NOWAIT and succeed after release',
  async boundary => {
    const groupId = await createGroup();
    const action =
      boundary === 'member target profile'
        ? 'groups.addGroupMember'
        : 'serviceInstances.update';
    const payload =
      boundary === 'member target profile'
        ? {
            groupId,
            userId: targetId,
            userIds: [actorId],
            serviceInstanceId: movingAppId,
          }
        : { id: movingAppId, updates: { visibility: 'private' } };
    const before = await serviceState();
    const holder = await fixtureDatabase().connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        boundary === 'member target profile'
          ? 'SELECT id FROM profiles WHERE id=$1 FOR UPDATE'
          : 'SELECT id FROM service_instances WHERE id=$1 FOR UPDATE',
        [boundary === 'member target profile' ? targetId : oldFallbackAppId]
      );
      const started = performance.now();
      const response = await call(action, payload);
      const elapsed = performance.now() - started;
      expect(response.statusCode).toBe(409);
      expect(elapsed).toBeLessThan(1900);
      expect(await auditFor(response.json().operationId)).toMatchObject({
        action,
        outcome: 'failed',
        changes: {},
      });
      expect(
        (
          await holder.query('SELECT id FROM group_members WHERE group_id=$1', [
            groupId,
          ])
        ).rows
      ).toEqual([]);
      expect(await serviceState()).toEqual(before);
    } finally {
      try {
        await holder.query('ROLLBACK');
      } finally {
        holder.release();
      }
    }
    const retry = await call(action, payload);
    expect(retry.statusCode).toBe(200);
    const audit = await auditFor(retry.json().operationId);
    expect(audit).toMatchObject({
      action,
      outcome: 'committed',
      changes: { changed: true, changedCount: 1 },
    });
    if (boundary === 'member target profile') {
      expect(
        (
          await fixtureDatabase().query(
            'SELECT user_id FROM group_members WHERE group_id=$1',
            [groupId]
          )
        ).rows
      ).toEqual([{ user_id: targetId }]);
    } else {
      expect(
        (await serviceState()).find(row => row.id === movingAppId)?.visibility
      ).toBe('private');
    }
  }
);

test('service deletion locks sibling defaults before snapshots and preserves a fallback after two deletions', async () => {
  const holder = await fixtureDatabase().connect();
  try {
    await holder.query('BEGIN');
    await holder.query(
      'SELECT id FROM service_instances WHERE id=$1 FOR UPDATE',
      [oldFallbackAppId]
    );
    const blocked = await call('serviceInstances.delete', { id: movingAppId });
    expect(blocked.statusCode).toBe(409);
    expect(await auditFor(blocked.json().operationId)).toMatchObject({
      outcome: 'failed',
      reason_code: 'ADMIN_MUTATION_BUSY',
    });
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
  const extraAppId = randomUUID();
  try {
    await fixtureDatabase().query(
      "INSERT INTO service_instances(id,provider_id,instance_id,visibility,is_default) VALUES($1,$2,$3,'public',false)",
      [extraAppId, oldProviderId, `${marker}-${extraAppId}`]
    );
    expect(
      (await call('serviceInstances.delete', { id: movingAppId })).statusCode
    ).toBe(200);
    expect(
      (await call('serviceInstances.delete', { id: oldFallbackAppId }))
        .statusCode
    ).toBe(200);
    expect(
      (
        await fixtureDatabase().query(
          'SELECT id,is_default FROM service_instances WHERE provider_id=$1',
          [oldProviderId]
        )
      ).rows
    ).toEqual([{ id: extraAppId, is_default: true }]);
  } finally {
    await fixtureDatabase().query('DELETE FROM service_instances WHERE id=$1', [
      extraAppId,
    ]);
  }
});
