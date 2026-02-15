import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const fallbackDatabaseUrl =
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui';
const databaseUrl =
  process.env.DATABASE_URL?.trim() ||
  process.env.PGURL?.trim() ||
  process.env.M4_RLS_DATABASE_URL?.trim() ||
  fallbackDatabaseUrl;

const migrationFiles = [
  'supabase/migrations/20260214010100_add_missing_rpc_functions.sql',
  'supabase/migrations/20260214020100_create_local_pg_baseline_schema.sql',
  'supabase/migrations/20260214061000_add_external_identity_profile_tables.sql',
  'supabase/migrations/20260214133000_enforce_single_idp_binding.sql',
  'supabase/migrations/20260214153000_create_better_auth_tables.sql',
  'supabase/migrations/20260214161000_add_local_login_policy_controls.sql',
  'supabase/migrations/20260214192000_add_better_auth_phone_fields.sql',
  'supabase/migrations/20260214201000_add_fallback_password_profile_metadata.sql',
  'supabase/migrations/20260215030000_m4_rpc_rls_guc_hardening.sql',
  'supabase/migrations/20260215050000_m4_table_rls_phase2.sql',
];

const targetTables = [
  'profiles',
  'conversations',
  'messages',
  'groups',
  'group_members',
  'group_app_permissions',
  'app_executions',
];
const rlsVerifierRole = 'agentif_rls_tester';

function applyMigration(relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  const result = spawnSync(
    'psql',
    [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', absolutePath],
    {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  if (result.status !== 0) {
    const message = [
      `[m4:rls:verify] failed to apply migration: ${relativePath}`,
      result.stdout || '',
      result.stderr || '',
    ]
      .filter(Boolean)
      .join('\n');
    throw new Error(message);
  }
}

async function withActorContext(pool, actorUserId, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${rlsVerifierRole}`);
    await client.query(`SELECT set_config('app.current_user_id', $1::text, true)`, [
      actorUserId || '',
    ]);
    await client.query(`SELECT set_config('app.current_user_role', $1::text, true)`, [
      '',
    ]);
    if (actorUserId) {
      const roleResult = await client.query(
        `
          SELECT COALESCE(role::text, 'user') AS role
          FROM profiles
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [actorUserId]
      );
      await client.query(`SELECT set_config('app.current_user_role', $1::text, true)`, [
        roleResult.rows[0]?.role || '',
      ]);
    }

    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function queryWithActor(pool, actorUserId, sql, params = []) {
  return withActorContext(pool, actorUserId, client => client.query(sql, params));
}

async function ensureRlsVerifierRole(pool) {
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = '${rlsVerifierRole}'
      ) THEN
        CREATE ROLE ${rlsVerifierRole} NOINHERIT;
      END IF;
    END
    $$;
  `);

  await pool.query(`GRANT USAGE ON SCHEMA public TO ${rlsVerifierRole}`);
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${rlsVerifierRole}`
  );
  await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${rlsVerifierRole}`);
  await pool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${rlsVerifierRole}`);
}

async function expectPgError(operation, expectedCode, label) {
  try {
    await operation();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      assert.equal(error.code, expectedCode, `${label}: unexpected error code`);
      return;
    }
    throw error;
  }

  throw new Error(`${label}: expected PG error code ${expectedCode}`);
}

async function seedFixtures(pool, ids) {
  await pool.query(
    `
      INSERT INTO providers (id, name, type, base_url, auth_type, is_active, is_default)
      VALUES ($1::uuid, $2, 'llm', 'https://rls.example.local', 'api_key', TRUE, TRUE)
    `,
    [ids.provider, `m4-rls-provider-${ids.suffix}`]
  );

  await pool.query(
    `
      INSERT INTO service_instances (
        id,
        provider_id,
        instance_id,
        api_path,
        display_name,
        description,
        is_default,
        visibility,
        config
      )
      VALUES
        ($1::uuid, $3::uuid, 'rls-public', '/v1', 'RLS Public', 'public app', TRUE, 'public', '{}'::jsonb),
        ($2::uuid, $3::uuid, 'rls-group', '/v1', 'RLS Group', 'group app', FALSE, 'group_only', '{}'::jsonb)
    `,
    [ids.instancePublic, ids.instanceGroup, ids.provider]
  );

  await pool.query(
    `
      INSERT INTO profiles (id, full_name, username, email, auth_source, role, status)
      VALUES
        ($1::uuid, 'RLS Admin', $4, $5, 'password', 'admin', 'active'),
        ($2::uuid, 'RLS User A', $6, $7, 'password', 'user', 'active'),
        ($3::uuid, 'RLS User B', $8, $9, 'password', 'user', 'active')
    `,
    [
      ids.adminUser,
      ids.userA,
      ids.userB,
      `m4-rls-admin-${ids.suffix}`,
      `m4-rls-admin-${ids.suffix}@example.com`,
      `m4-rls-usera-${ids.suffix}`,
      `m4-rls-usera-${ids.suffix}@example.com`,
      `m4-rls-userb-${ids.suffix}`,
      `m4-rls-userb-${ids.suffix}@example.com`,
    ]
  );

  await pool.query(
    `
      INSERT INTO groups (id, name, description, created_by)
      VALUES ($1::uuid, $2, 'm4 rls group', $3::uuid)
    `,
    [ids.group, `m4-rls-group-${ids.suffix}`, ids.adminUser]
  );

  await pool.query(
    `
      INSERT INTO group_members (id, group_id, user_id)
      VALUES ($1::uuid, $2::uuid, $3::uuid)
    `,
    [ids.groupMemberA, ids.group, ids.userA]
  );

  await pool.query(
    `
      INSERT INTO group_app_permissions (
        id,
        group_id,
        service_instance_id,
        is_enabled,
        usage_quota,
        used_count
      )
      VALUES ($1::uuid, $2::uuid, $3::uuid, TRUE, 10, 4)
    `,
    [ids.groupPermission, ids.group, ids.instanceGroup]
  );

  await pool.query(
    `
      INSERT INTO conversations (
        id,
        user_id,
        ai_config_id,
        title,
        summary,
        settings,
        metadata,
        status,
        external_id,
        app_id,
        last_message_preview
      )
      VALUES
        ($1::uuid, $3::uuid, NULL, 'RLS convo A', NULL, '{}'::jsonb, '{}'::jsonb, 'active', NULL, 'chat-app', NULL),
        ($2::uuid, $4::uuid, NULL, 'RLS convo B', NULL, '{}'::jsonb, '{}'::jsonb, 'active', NULL, 'chat-app', NULL)
    `,
    [ids.conversationA, ids.conversationB, ids.userA, ids.userB]
  );

  await pool.query(
    `
      INSERT INTO messages (
        id,
        conversation_id,
        user_id,
        role,
        content,
        metadata,
        status,
        external_id,
        token_count,
        is_synced,
        sequence_index
      )
      VALUES
        ($1::uuid, $3::uuid, $5::uuid, 'user', 'hello from A', '{}'::jsonb, 'sent', NULL, 1, TRUE, 0),
        ($2::uuid, $4::uuid, $6::uuid, 'user', 'hello from B', '{}'::jsonb, 'sent', NULL, 1, TRUE, 0)
    `,
    [ids.messageA, ids.messageB, ids.conversationA, ids.conversationB, ids.userA, ids.userB]
  );

  await pool.query(
    `
      INSERT INTO app_executions (
        id,
        user_id,
        service_instance_id,
        execution_type,
        title,
        status
      )
      VALUES
        ($1::uuid, $3::uuid, $5::uuid, 'workflow', 'RLS exec A', 'pending'),
        ($2::uuid, $4::uuid, $5::uuid, 'workflow', 'RLS exec B', 'pending')
    `,
    [ids.executionA, ids.executionB, ids.userA, ids.userB, ids.instancePublic]
  );
}

async function cleanupFixtures(pool, ids) {
  await pool.query(
    `DELETE FROM app_executions WHERE id = ANY($1::uuid[])`,
    [[ids.executionA, ids.executionB]]
  );
  await pool.query(
    `DELETE FROM messages WHERE id = ANY($1::uuid[])`,
    [[ids.messageA, ids.messageB]]
  );
  await pool.query(
    `DELETE FROM conversations WHERE id = ANY($1::uuid[])`,
    [[ids.conversationA, ids.conversationB]]
  );
  await pool.query(
    `DELETE FROM group_app_permissions WHERE id = ANY($1::uuid[])`,
    [[ids.groupPermission]]
  );
  await pool.query(
    `DELETE FROM group_members WHERE id = ANY($1::uuid[])`,
    [[ids.groupMemberA]]
  );
  await pool.query(`DELETE FROM groups WHERE id = ANY($1::uuid[])`, [[ids.group]]);
  await pool.query(
    `DELETE FROM service_instances WHERE id = ANY($1::uuid[])`,
    [[ids.instancePublic, ids.instanceGroup]]
  );
  await pool.query(
    `DELETE FROM providers WHERE id = ANY($1::uuid[])`,
    [[ids.provider]]
  );
  await pool.query(
    `DELETE FROM profiles WHERE id = ANY($1::uuid[])`,
    [[ids.adminUser, ids.userA, ids.userB]]
  );
}

async function main() {
  for (const migrationFile of migrationFiles) {
    applyMigration(migrationFile);
  }

  const ids = {
    suffix: randomUUID().slice(0, 8),
    provider: randomUUID(),
    instancePublic: randomUUID(),
    instanceGroup: randomUUID(),
    adminUser: randomUUID(),
    userA: randomUUID(),
    userB: randomUUID(),
    group: randomUUID(),
    groupMemberA: randomUUID(),
    groupPermission: randomUUID(),
    conversationA: randomUUID(),
    conversationB: randomUUID(),
    messageA: randomUUID(),
    messageB: randomUUID(),
    executionA: randomUUID(),
    executionB: randomUUID(),
  };

  const pool = new Pool({ connectionString: databaseUrl });

  const checks = {
    rlsEnabledForCoreTables: false,
    policyCoverageForCoreTables: false,
    legacyNoActorBypass: false,
    profilesSelfIsolation: false,
    profileCrossInsertForbidden: false,
    conversationsSelfIsolation: false,
    conversationCrossInsertForbidden: false,
    messagesCrossConversationForbidden: false,
    appExecutionsSelfIsolation: false,
    groupPermissionMemberScope: false,
    groupPermissionMemberUpdateScope: false,
    adminVisibilityAcrossCoreData: false,
  };

  try {
    await ensureRlsVerifierRole(pool);
    await seedFixtures(pool, ids);

    const rlsStatusRows = await pool.query(
      `
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname = ANY($1::text[])
        ORDER BY c.relname
      `,
      [targetTables]
    );
    checks.rlsEnabledForCoreTables =
      rlsStatusRows.rowCount === targetTables.length &&
      rlsStatusRows.rows.every(
        row => row.relrowsecurity === true && row.relforcerowsecurity === true
      );

    const policyRows = await pool.query(
      `
        SELECT tablename, COUNT(*)::int AS count
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY($1::text[])
        GROUP BY tablename
      `,
      [targetTables]
    );
    const policyMap = new Map(
      policyRows.rows.map(row => [String(row.tablename), Number(row.count)])
    );
    checks.policyCoverageForCoreTables = targetTables.every(
      tableName => (policyMap.get(tableName) || 0) >= 4
    );

    const legacyProfiles = await queryWithActor(
      pool,
      null,
      `
        SELECT id::text
        FROM profiles
        WHERE id = ANY($1::uuid[])
      `,
      [[ids.adminUser, ids.userA, ids.userB]]
    );
    checks.legacyNoActorBypass = legacyProfiles.rowCount === 3;

    const scopedProfiles = await queryWithActor(
      pool,
      ids.userA,
      `
        SELECT id::text
        FROM profiles
        WHERE id = ANY($1::uuid[])
      `,
      [[ids.adminUser, ids.userA, ids.userB]]
    );
    const scopedProfileIds = new Set(scopedProfiles.rows.map(row => String(row.id)));
    checks.profilesSelfIsolation =
      scopedProfileIds.has(ids.userA) &&
      !scopedProfileIds.has(ids.userB) &&
      !scopedProfileIds.has(ids.adminUser);

    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.userA,
          `
            INSERT INTO profiles (
              id,
              username,
              email,
              auth_source,
              role,
              status
            )
            VALUES ($1::uuid, $2, $3, 'password', 'user', 'active')
          `,
          [
            randomUUID(),
            `m4-rls-forbidden-${ids.suffix}`,
            `m4-rls-forbidden-${ids.suffix}@example.com`,
          ]
        ),
      '42501',
      'profiles-cross-insert-forbidden'
    );
    checks.profileCrossInsertForbidden = true;

    const scopedConversations = await queryWithActor(
      pool,
      ids.userA,
      `
        SELECT id::text
        FROM conversations
        WHERE id = ANY($1::uuid[])
      `,
      [[ids.conversationA, ids.conversationB]]
    );
    const scopedConversationIds = new Set(
      scopedConversations.rows.map(row => String(row.id))
    );
    checks.conversationsSelfIsolation =
      scopedConversationIds.has(ids.conversationA) &&
      !scopedConversationIds.has(ids.conversationB);

    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.userA,
          `
            INSERT INTO conversations (
              id,
              user_id,
              ai_config_id,
              title,
              settings,
              metadata,
              status
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              NULL,
              'forbidden conversation',
              '{}'::jsonb,
              '{}'::jsonb,
              'active'
            )
          `,
          [randomUUID(), ids.userB]
        ),
      '42501',
      'conversations-cross-insert-forbidden'
    );
    checks.conversationCrossInsertForbidden = true;

    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.userA,
          `
            INSERT INTO messages (
              id,
              conversation_id,
              user_id,
              role,
              content,
              metadata,
              status,
              is_synced,
              sequence_index
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              $3::uuid,
              'user',
              'forbidden message',
              '{}'::jsonb,
              'sent',
              TRUE,
              0
            )
          `,
          [randomUUID(), ids.conversationB, ids.userA]
        ),
      '42501',
      'messages-cross-conversation-forbidden'
    );
    checks.messagesCrossConversationForbidden = true;

    const scopedExecutions = await queryWithActor(
      pool,
      ids.userA,
      `
        SELECT id::text
        FROM app_executions
        WHERE id = ANY($1::uuid[])
      `,
      [[ids.executionA, ids.executionB]]
    );
    const scopedExecutionIds = new Set(
      scopedExecutions.rows.map(row => String(row.id))
    );
    checks.appExecutionsSelfIsolation =
      scopedExecutionIds.has(ids.executionA) &&
      !scopedExecutionIds.has(ids.executionB);

    const permissionVisibleForA = await queryWithActor(
      pool,
      ids.userA,
      `
        SELECT id::text
        FROM group_app_permissions
        WHERE id = $1::uuid
      `,
      [ids.groupPermission]
    );
    const permissionVisibleForB = await queryWithActor(
      pool,
      ids.userB,
      `
        SELECT id::text
        FROM group_app_permissions
        WHERE id = $1::uuid
      `,
      [ids.groupPermission]
    );
    checks.groupPermissionMemberScope =
      permissionVisibleForA.rowCount === 1 && permissionVisibleForB.rowCount === 0;

    const updatePermissionByA = await queryWithActor(
      pool,
      ids.userA,
      `
        UPDATE group_app_permissions
        SET used_count = used_count + 1
        WHERE id = $1::uuid
        RETURNING used_count
      `,
      [ids.groupPermission]
    );
    const updatePermissionByB = await queryWithActor(
      pool,
      ids.userB,
      `
        UPDATE group_app_permissions
        SET used_count = used_count + 1
        WHERE id = $1::uuid
        RETURNING used_count
      `,
      [ids.groupPermission]
    );
    checks.groupPermissionMemberUpdateScope =
      updatePermissionByA.rowCount === 1 && updatePermissionByB.rowCount === 0;

    const adminProfileView = await queryWithActor(
      pool,
      ids.adminUser,
      `
        SELECT COUNT(*)::int AS total
        FROM profiles
        WHERE id = ANY($1::uuid[])
      `,
      [[ids.adminUser, ids.userA, ids.userB]]
    );
    const adminConversationView = await queryWithActor(
      pool,
      ids.adminUser,
      `
        SELECT COUNT(*)::int AS total
        FROM conversations
        WHERE id = ANY($1::uuid[])
      `,
      [[ids.conversationA, ids.conversationB]]
    );
    checks.adminVisibilityAcrossCoreData =
      Number(adminProfileView.rows[0]?.total || 0) === 3 &&
      Number(adminConversationView.rows[0]?.total || 0) === 2;

    const failedChecks = Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    if (failedChecks.length > 0) {
      throw new Error(`[m4:rls:verify] failed checks: ${failedChecks.join(', ')}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks,
          tables: targetTables,
          ids: {
            adminUser: ids.adminUser,
            userA: ids.userA,
            userB: ids.userB,
            groupPermission: ids.groupPermission,
          },
        },
        null,
        2
      )
    );
  } finally {
    try {
      await cleanupFixtures(pool, ids);
    } finally {
      await pool.end();
    }
  }
}

main().catch(error => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
