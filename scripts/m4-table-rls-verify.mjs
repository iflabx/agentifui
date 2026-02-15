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
const runtimeDatabaseUrl =
  process.env.DATABASE_URL?.trim() ||
  process.env.PGURL?.trim() ||
  process.env.M4_RLS_DATABASE_URL?.trim() ||
  fallbackDatabaseUrl;
const migratorDatabaseUrl =
  process.env.MIGRATOR_DATABASE_URL?.trim() ||
  process.env.M4_MIGRATOR_DATABASE_URL?.trim() ||
  process.env.M4_RLS_MIGRATOR_DATABASE_URL?.trim() ||
  runtimeDatabaseUrl;

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
  'supabase/migrations/20260215070000_m4_table_rls_phase3.sql',
];

const phase2Tables = [
  'profiles',
  'conversations',
  'messages',
  'groups',
  'group_members',
  'group_app_permissions',
  'app_executions',
];

const phase3Tables = [
  'providers',
  'service_instances',
  'api_keys',
  'sso_providers',
  'domain_sso_mappings',
  'auth_settings',
  'user_identities',
  'profile_external_attributes',
  'auth_local_login_audit_logs',
];

const allTargetTables = [...phase2Tables, ...phase3Tables];

function applyMigration(relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  const result = spawnSync(
    'psql',
    [migratorDatabaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', absolutePath],
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
        ($1::uuid, $4::uuid, 'rls-public', '/v1', 'RLS Public', 'public app', TRUE, 'public', '{}'::jsonb),
        ($2::uuid, $4::uuid, 'rls-group', '/v1', 'RLS Group', 'group app', FALSE, 'group_only', '{}'::jsonb),
        ($3::uuid, $4::uuid, 'rls-private', '/v1', 'RLS Private', 'private app', FALSE, 'private', '{}'::jsonb)
    `,
    [ids.instancePublic, ids.instanceGroup, ids.instancePrivate, ids.provider]
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
      INSERT INTO api_keys (
        id,
        provider_id,
        service_instance_id,
        user_id,
        key_value,
        is_default,
        usage_count
      )
      VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, 'm4-rls-key', TRUE, 0)
    `,
    [ids.apiKey, ids.provider, ids.instancePublic]
  );

  await pool.query(
    `
      INSERT INTO sso_providers (
        id,
        name,
        protocol,
        settings,
        enabled,
        display_order
      )
      VALUES ($1::uuid, $2, 'OIDC', '{}'::jsonb, TRUE, 10)
    `,
    [ids.ssoProvider, `m4-rls-sso-${ids.suffix}`]
  );

  await pool.query(
    `
      INSERT INTO domain_sso_mappings (
        id,
        domain,
        sso_provider_id,
        enabled
      )
      VALUES ($1::uuid, $2, $3::uuid, TRUE)
    `,
    [ids.domainMapping, `m4-rls-${ids.suffix}.example.com`, ids.ssoProvider]
  );

  await pool.query(
    `
      INSERT INTO auth_settings (
        id,
        allow_email_registration,
        allow_password_login,
        allow_phone_registration,
        require_email_verification,
        auth_mode
      )
      VALUES ($1::uuid, FALSE, TRUE, FALSE, TRUE, 'normal')
    `,
    [ids.authSetting]
  );

  await pool.query(
    `
      INSERT INTO user_identities (
        user_id,
        issuer,
        provider,
        subject,
        email,
        email_verified,
        raw_claims
      )
      VALUES
        ($1::uuid, 'https://idp.example.com', 'oidc', $3, $4, TRUE, '{}'::jsonb),
        ($2::uuid, 'https://idp.example.com', 'oidc', $5, $6, TRUE, '{}'::jsonb)
    `,
    [
      ids.userA,
      ids.userB,
      `sub-a-${ids.suffix}`,
      `m4-identity-a-${ids.suffix}@example.com`,
      `sub-b-${ids.suffix}`,
      `m4-identity-b-${ids.suffix}@example.com`,
    ]
  );

  await pool.query(
    `
      INSERT INTO profile_external_attributes (
        user_id,
        source_issuer,
        source_provider,
        department_code,
        department_name,
        attributes,
        raw_profile
      )
      VALUES
        ($1::uuid, 'https://idp.example.com', 'oidc', 'D-A', 'Dept A', '{}'::jsonb, '{}'::jsonb),
        ($2::uuid, 'https://idp.example.com', 'oidc', 'D-B', 'Dept B', '{}'::jsonb, '{}'::jsonb)
    `,
    [ids.userA, ids.userB]
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
    `DELETE FROM auth_local_login_audit_logs WHERE email LIKE $1`,
    [`m4-rls-%-${ids.suffix}@example.com`]
  );
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
    `DELETE FROM profile_external_attributes WHERE user_id = ANY($1::uuid[])`,
    [[ids.userA, ids.userB]]
  );
  await pool.query(
    `DELETE FROM user_identities WHERE user_id = ANY($1::uuid[])`,
    [[ids.userA, ids.userB]]
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
    `DELETE FROM domain_sso_mappings WHERE id = ANY($1::uuid[])`,
    [[ids.domainMapping]]
  );
  await pool.query(
    `DELETE FROM sso_providers WHERE id = ANY($1::uuid[])`,
    [[ids.ssoProvider]]
  );
  await pool.query(
    `DELETE FROM auth_settings WHERE id = ANY($1::uuid[])`,
    [[ids.authSetting]]
  );
  await pool.query(`DELETE FROM api_keys WHERE id = ANY($1::uuid[])`, [[ids.apiKey]]);
  await pool.query(
    `DELETE FROM service_instances WHERE id = ANY($1::uuid[])`,
    [[
      ids.instancePublic,
      ids.instanceGroup,
      ids.instancePrivate,
      ids.adminCreatedInstance,
    ]]
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
    instancePrivate: randomUUID(),
    adminCreatedInstance: randomUUID(),
    apiKey: randomUUID(),
    ssoProvider: randomUUID(),
    domainMapping: randomUUID(),
    authSetting: randomUUID(),
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

  const pool = new Pool({ connectionString: runtimeDatabaseUrl });

  const checks = {
    rlsEnabledForAllTables: false,
    policyCoverageForAllTables: false,
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

    serviceInstanceVisibilityScope: false,
    serviceInstanceAdminCanSeePrivate: false,
    serviceInstanceInsertAdminOnly: false,

    apiKeysAdminOnly: false,
    ssoProvidersAdminOnly: false,
    domainMappingsAdminOnly: false,
    authSettingsAdminOnly: false,

    userIdentitiesSelfIsolation: false,
    profileExternalAttributesSelfIsolation: false,
  };

  try {
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
      [allTargetTables]
    );
    checks.rlsEnabledForAllTables =
      rlsStatusRows.rowCount === allTargetTables.length &&
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
      [allTargetTables]
    );
    const policyMap = new Map(
      policyRows.rows.map(row => [String(row.tablename), Number(row.count)])
    );
    checks.policyCoverageForAllTables = allTargetTables.every(
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

    const serviceRowsA = await queryWithActor(
      pool,
      ids.userA,
      `
        SELECT id::text
        FROM service_instances
        WHERE id = ANY($1::uuid[])
      `,
      [[ids.instancePublic, ids.instanceGroup, ids.instancePrivate]]
    );
    const serviceRowsB = await queryWithActor(
      pool,
      ids.userB,
      `
        SELECT id::text
        FROM service_instances
        WHERE id = ANY($1::uuid[])
      `,
      [[ids.instancePublic, ids.instanceGroup, ids.instancePrivate]]
    );
    const servicesA = new Set(serviceRowsA.rows.map(row => String(row.id)));
    const servicesB = new Set(serviceRowsB.rows.map(row => String(row.id)));
    checks.serviceInstanceVisibilityScope =
      servicesA.has(ids.instancePublic) &&
      servicesA.has(ids.instanceGroup) &&
      !servicesA.has(ids.instancePrivate) &&
      servicesB.has(ids.instancePublic) &&
      !servicesB.has(ids.instanceGroup) &&
      !servicesB.has(ids.instancePrivate);

    const serviceRowsAdmin = await queryWithActor(
      pool,
      ids.adminUser,
      `
        SELECT id::text
        FROM service_instances
        WHERE id = ANY($1::uuid[])
      `,
      [[ids.instancePublic, ids.instanceGroup, ids.instancePrivate]]
    );
    checks.serviceInstanceAdminCanSeePrivate = serviceRowsAdmin.rowCount === 3;

    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.userA,
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
            VALUES (
              $1::uuid,
              $2::uuid,
              'forbidden-instance',
              '/v1',
              'forbidden',
              'forbidden',
              FALSE,
              'public',
              '{}'::jsonb
            )
          `,
          [ids.adminCreatedInstance, ids.provider]
        ),
      '42501',
      'service-instance-insert-admin-only'
    );

    const adminInsertService = await queryWithActor(
      pool,
      ids.adminUser,
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
        VALUES (
          $1::uuid,
          $2::uuid,
          'admin-instance',
          '/v1',
          'admin instance',
          'admin insert allowed',
          FALSE,
          'public',
          '{}'::jsonb
        )
        RETURNING id::text
      `,
      [ids.adminCreatedInstance, ids.provider]
    );
    checks.serviceInstanceInsertAdminOnly = adminInsertService.rowCount === 1;

    const apiKeyViewUser = await queryWithActor(
      pool,
      ids.userA,
      `
        SELECT id::text
        FROM api_keys
        WHERE id = $1::uuid
      `,
      [ids.apiKey]
    );
    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.userA,
          `
            INSERT INTO api_keys (
              id,
              provider_id,
              service_instance_id,
              user_id,
              key_value,
              is_default,
              usage_count
            )
            VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, 'x', FALSE, 0)
          `,
          [randomUUID(), ids.provider, ids.instancePublic]
        ),
      '42501',
      'api-keys-admin-only'
    );
    const apiKeyViewAdmin = await queryWithActor(
      pool,
      ids.adminUser,
      `
        SELECT id::text
        FROM api_keys
        WHERE id = $1::uuid
      `,
      [ids.apiKey]
    );
    checks.apiKeysAdminOnly =
      apiKeyViewUser.rowCount === 0 && apiKeyViewAdmin.rowCount === 1;

    const ssoViewUser = await queryWithActor(
      pool,
      ids.userA,
      `
        SELECT id::text
        FROM sso_providers
        WHERE id = $1::uuid
      `,
      [ids.ssoProvider]
    );
    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.userA,
          `
            INSERT INTO sso_providers (
              id,
              name,
              protocol,
              settings,
              enabled,
              display_order
            )
            VALUES ($1::uuid, $2, 'CAS', '{}'::jsonb, TRUE, 20)
          `,
          [randomUUID(), `sso-forbidden-${ids.suffix}`]
        ),
      '42501',
      'sso-providers-admin-only'
    );
    const ssoViewAdmin = await queryWithActor(
      pool,
      ids.adminUser,
      `
        SELECT id::text
        FROM sso_providers
        WHERE id = $1::uuid
      `,
      [ids.ssoProvider]
    );
    checks.ssoProvidersAdminOnly =
      ssoViewUser.rowCount === 0 && ssoViewAdmin.rowCount === 1;

    const domainViewUser = await queryWithActor(
      pool,
      ids.userA,
      `
        SELECT id::text
        FROM domain_sso_mappings
        WHERE id = $1::uuid
      `,
      [ids.domainMapping]
    );
    const domainViewAdmin = await queryWithActor(
      pool,
      ids.adminUser,
      `
        SELECT id::text
        FROM domain_sso_mappings
        WHERE id = $1::uuid
      `,
      [ids.domainMapping]
    );
    checks.domainMappingsAdminOnly =
      domainViewUser.rowCount === 0 && domainViewAdmin.rowCount === 1;

    const authSettingsViewUser = await queryWithActor(
      pool,
      ids.userA,
      `
        SELECT id::text
        FROM auth_settings
        WHERE id = $1::uuid
      `,
      [ids.authSetting]
    );
    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.userA,
          `
            INSERT INTO auth_settings (
              id,
              allow_email_registration,
              allow_password_login,
              allow_phone_registration,
              require_email_verification,
              auth_mode
            )
            VALUES ($1::uuid, FALSE, TRUE, FALSE, TRUE, 'normal')
          `,
          [randomUUID()]
        ),
      '42501',
      'auth-settings-admin-only'
    );
    const authSettingsViewAdmin = await queryWithActor(
      pool,
      ids.adminUser,
      `
        SELECT id::text
        FROM auth_settings
        WHERE id = $1::uuid
      `,
      [ids.authSetting]
    );
    checks.authSettingsAdminOnly =
      authSettingsViewUser.rowCount === 0 && authSettingsViewAdmin.rowCount === 1;

    const identityRowsUserA = await queryWithActor(
      pool,
      ids.userA,
      `
        SELECT user_id::text
        FROM user_identities
        WHERE user_id = ANY($1::uuid[])
      `,
      [[ids.userA, ids.userB]]
    );
    const identityRowsAdmin = await queryWithActor(
      pool,
      ids.adminUser,
      `
        SELECT user_id::text
        FROM user_identities
        WHERE user_id = ANY($1::uuid[])
      `,
      [[ids.userA, ids.userB]]
    );
    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.userA,
          `
            INSERT INTO user_identities (
              user_id,
              issuer,
              provider,
              subject,
              email,
              email_verified,
              raw_claims
            )
            VALUES (
              $1::uuid,
              'https://idp.example.com',
              'oidc',
              $2,
              $3,
              TRUE,
              '{}'::jsonb
            )
          `,
          [ids.userB, `forbidden-sub-${ids.suffix}`, `forbidden-${ids.suffix}@example.com`]
        ),
      '42501',
      'user-identities-self-isolation'
    );
    checks.userIdentitiesSelfIsolation =
      identityRowsUserA.rowCount === 1 && identityRowsAdmin.rowCount === 2;

    const attrsRowsUserA = await queryWithActor(
      pool,
      ids.userA,
      `
        SELECT user_id::text
        FROM profile_external_attributes
        WHERE user_id = ANY($1::uuid[])
      `,
      [[ids.userA, ids.userB]]
    );
    const attrsRowsAdmin = await queryWithActor(
      pool,
      ids.adminUser,
      `
        SELECT user_id::text
        FROM profile_external_attributes
        WHERE user_id = ANY($1::uuid[])
      `,
      [[ids.userA, ids.userB]]
    );
    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.userA,
          `
            INSERT INTO profile_external_attributes (
              user_id,
              source_issuer,
              source_provider,
              attributes,
              raw_profile
            )
            VALUES (
              $1::uuid,
              'https://idp.example.com',
              'oidc',
              '{}'::jsonb,
              '{}'::jsonb
            )
          `,
          [ids.userB]
        ),
      '42501',
      'profile-external-attributes-self-isolation'
    );
    checks.profileExternalAttributesSelfIsolation =
      attrsRowsUserA.rowCount === 1 && attrsRowsAdmin.rowCount === 2;

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
          tables: {
            phase2: phase2Tables,
            phase3: phase3Tables,
          },
          ids: {
            adminUser: ids.adminUser,
            userA: ids.userA,
            userB: ids.userB,
            provider: ids.provider,
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
