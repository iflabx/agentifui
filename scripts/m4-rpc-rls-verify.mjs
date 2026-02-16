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
  process.env.M4_RPC_DATABASE_URL?.trim() ||
  fallbackDatabaseUrl;
const migratorDatabaseUrl =
  process.env.MIGRATOR_DATABASE_URL?.trim() ||
  process.env.M4_MIGRATOR_DATABASE_URL?.trim() ||
  process.env.M4_RPC_MIGRATOR_DATABASE_URL?.trim() ||
  runtimeDatabaseUrl;

const migrationFiles = [
  'database/migrations/20260214010100_add_missing_rpc_functions.sql',
  'database/migrations/20260214020100_create_local_pg_baseline_schema.sql',
  'database/migrations/20260214061000_add_external_identity_profile_tables.sql',
  'database/migrations/20260214133000_enforce_single_idp_binding.sql',
  'database/migrations/20260214153000_create_better_auth_tables.sql',
  'database/migrations/20260214161000_add_local_login_policy_controls.sql',
  'database/migrations/20260214192000_add_better_auth_phone_fields.sql',
  'database/migrations/20260214201000_add_fallback_password_profile_metadata.sql',
  'database/migrations/20260215030000_m4_rpc_rls_guc_hardening.sql',
  'database/migrations/20260215050000_m4_table_rls_phase2.sql',
  'database/migrations/20260215070000_m4_table_rls_phase3.sql',
  'database/migrations/20260215080000_m4_rls_strict_mode_switch.sql',
];

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
      `[m4:rpc:verify] failed to apply migration: ${relativePath}`,
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
      VALUES ($1::uuid, $2, 'llm', 'https://rpc.example.local', 'api_key', TRUE, TRUE)
    `,
    [ids.provider, `m4-provider-${ids.suffix}`]
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
        ($1::uuid, $4::uuid, 'public-instance', '/v1', 'M4 Public', 'public app', TRUE, 'public', '{}'::jsonb),
        ($2::uuid, $4::uuid, 'group-instance', '/v1', 'M4 Group', 'group app', FALSE, 'group_only', '{}'::jsonb),
        ($3::uuid, $4::uuid, 'private-instance', '/v1', 'M4 Private', 'private app', FALSE, 'private', '{}'::jsonb)
    `,
    [ids.instancePublic, ids.instanceGroup, ids.instancePrivate, ids.provider]
  );

  await pool.query(
    `
      INSERT INTO profiles (id, full_name, username, email, auth_source, role, status)
      VALUES
        ($1::uuid, 'M4 Admin', $5, $6, 'password', 'admin', 'active'),
        ($2::uuid, 'M4 User A', $7, $8, 'password', 'user', 'active'),
        ($3::uuid, 'M4 User B', $9, $10, 'password', 'user', 'active'),
        ($4::uuid, 'M4 Victim', $11, $12, 'password', 'user', 'active')
    `,
    [
      ids.adminUser,
      ids.userA,
      ids.userB,
      ids.victimUser,
      `m4-admin-${ids.suffix}`,
      `m4-admin-${ids.suffix}@example.com`,
      `m4-usera-${ids.suffix}`,
      `m4-usera-${ids.suffix}@example.com`,
      `m4-userb-${ids.suffix}`,
      `m4-userb-${ids.suffix}@example.com`,
      `m4-victim-${ids.suffix}`,
      `m4-victim-${ids.suffix}@example.com`,
    ]
  );

  await pool.query(
    `
      INSERT INTO groups (id, name, description, created_by)
      VALUES ($1::uuid, $2, 'm4 test group', $3::uuid)
    `,
    [ids.group, `m4-group-${ids.suffix}`, ids.adminUser]
  );

  await pool.query(
    `
      INSERT INTO group_members (id, group_id, user_id)
      VALUES ($1::uuid, $2::uuid, $3::uuid)
    `,
    [ids.groupMember, ids.group, ids.userA]
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
      VALUES ($1::uuid, $2::uuid, $3::uuid, TRUE, 5, 4)
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
      VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, 'm4-encrypted-key', TRUE, 0)
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
      VALUES
        ($1::uuid, $3, 'OIDC', '{}'::jsonb, TRUE, 10),
        ($2::uuid, $4, 'CAS', '{}'::jsonb, TRUE, 20)
    `,
    [
      ids.sso1,
      ids.sso2,
      `m4-sso-oidc-${ids.suffix}`,
      `m4-sso-cas-${ids.suffix}`,
    ]
  );
}

async function cleanupFixtures(pool, ids) {
  await pool.query(
    `DELETE FROM group_app_permissions WHERE id = ANY($1::uuid[])`,
    [[ids.groupPermission]]
  );
  await pool.query(
    `DELETE FROM group_members WHERE id = ANY($1::uuid[])`,
    [[ids.groupMember]]
  );
  await pool.query(`DELETE FROM groups WHERE id = ANY($1::uuid[])`, [[ids.group]]);
  await pool.query(`DELETE FROM api_keys WHERE id = ANY($1::uuid[])`, [[ids.apiKey]]);
  await pool.query(
    `DELETE FROM service_instances WHERE id = ANY($1::uuid[])`,
    [[ids.instancePublic, ids.instanceGroup, ids.instancePrivate]]
  );
  await pool.query(
    `DELETE FROM providers WHERE id = ANY($1::uuid[])`,
    [[ids.provider]]
  );
  await pool.query(
    `DELETE FROM sso_providers WHERE id = ANY($1::uuid[])`,
    [[ids.sso1, ids.sso2]]
  );
  await pool.query(
    `DELETE FROM profiles WHERE id = ANY($1::uuid[])`,
    [[ids.adminUser, ids.userA, ids.userB, ids.victimUser]]
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
    adminUser: randomUUID(),
    userA: randomUUID(),
    userB: randomUUID(),
    victimUser: randomUUID(),
    group: randomUUID(),
    groupMember: randomUUID(),
    groupPermission: randomUUID(),
    apiKey: randomUUID(),
    sso1: randomUUID(),
    sso2: randomUUID(),
  };

  const pool = new Pool({ connectionString: runtimeDatabaseUrl });
  const checks = {
    userAccessibleApps: false,
    userScopeForbidden: false,
    statsAdminRequired: false,
    adminStatsOk: false,
    detailAdminRequired: false,
    safeDeleteAdminRequired: false,
    safeDeleteAdminOk: false,
    incrementApiKeyMissingHandled: false,
    ssoOrderAdminRequired: false,
    ssoOrderMissingPkError: false,
    quotaConcurrencyDeterministic: false,
    defaultSwitchDeterministic: false,
  };

  try {
    await seedFixtures(pool, ids);

    const appsResult = await queryWithActor(
      pool,
      ids.userA,
      `SELECT service_instance_id::text AS service_instance_id FROM get_user_accessible_apps($1::uuid)`,
      [ids.userA]
    );
    const accessibleIds = new Set(
      appsResult.rows.map(row => String(row.service_instance_id))
    );
    checks.userAccessibleApps =
      accessibleIds.has(ids.instancePublic) && accessibleIds.has(ids.instanceGroup);

    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.userB,
          `SELECT * FROM check_user_app_permission($1::uuid, $2::uuid)`,
          [ids.userA, ids.instanceGroup]
        ),
      '42501',
      'user-scope-forbidden'
    );
    checks.userScopeForbidden = true;

    await expectPgError(
      () => queryWithActor(pool, ids.userA, `SELECT get_user_stats()`),
      '42501',
      'stats-admin-required'
    );
    checks.statsAdminRequired = true;

    const statsResult = await queryWithActor(
      pool,
      ids.adminUser,
      `SELECT get_user_stats() AS payload`
    );
    checks.adminStatsOk = Number(statsResult.rows[0]?.payload?.totalUsers || 0) >= 3;

    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.userA,
          `SELECT * FROM get_user_detail_for_admin($1::uuid)`,
          [ids.userA]
        ),
      '42501',
      'detail-admin-required'
    );
    checks.detailAdminRequired = true;

    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.userA,
          `SELECT safe_delete_user($1::uuid)`,
          [ids.victimUser]
        ),
      '42501',
      'safe-delete-admin-required'
    );
    checks.safeDeleteAdminRequired = true;

    const safeDeleteResult = await queryWithActor(
      pool,
      ids.adminUser,
      `SELECT safe_delete_user($1::uuid) AS deleted`,
      [ids.victimUser]
    );
    checks.safeDeleteAdminOk = safeDeleteResult.rows[0]?.deleted === true;

    const apiKeyMissingResult = await queryWithActor(
      pool,
      ids.adminUser,
      `SELECT * FROM increment_api_key_usage($1::uuid)`,
      [randomUUID()]
    );
    checks.incrementApiKeyMissingHandled =
      apiKeyMissingResult.rows[0]?.success === false;

    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.userA,
          `SELECT update_sso_provider_order($1::jsonb)`,
          [JSON.stringify([{ id: ids.sso1, display_order: 1 }])]
        ),
      '42501',
      'sso-order-admin-required'
    );
    checks.ssoOrderAdminRequired = true;

    await expectPgError(
      () =>
        queryWithActor(
          pool,
          ids.adminUser,
          `SELECT update_sso_provider_order($1::jsonb)`,
          [JSON.stringify([{ id: randomUUID(), display_order: 1 }])]
        ),
      'P0001',
      'sso-order-missing-pk'
    );
    checks.ssoOrderMissingPkError = true;

    const incrementOnce = () =>
      queryWithActor(
        pool,
        ids.userA,
        `SELECT * FROM increment_app_usage($1::uuid, $2::uuid, $3::integer)`,
        [ids.userA, ids.instanceGroup, 1]
      );
    const [incA, incB] = await Promise.all([incrementOnce(), incrementOnce()]);
    const incRows = [incA.rows[0], incB.rows[0]];
    const successCount = incRows.filter(row => row?.success === true).length;

    const usageAfter = await pool.query(
      `
        SELECT used_count, usage_quota
        FROM group_app_permissions
        WHERE id = $1::uuid
      `,
      [ids.groupPermission]
    );

    checks.quotaConcurrencyDeterministic =
      successCount === 1 &&
      Number(usageAfter.rows[0]?.used_count || 0) === 5 &&
      Number(usageAfter.rows[0]?.usage_quota || 0) === 5;

    const switchA = queryWithActor(
      pool,
      ids.adminUser,
      `SELECT set_default_service_instance($1::uuid, $2::uuid)`,
      [ids.instancePublic, ids.provider]
    );
    const switchB = queryWithActor(
      pool,
      ids.adminUser,
      `SELECT set_default_service_instance($1::uuid, $2::uuid)`,
      [ids.instanceGroup, ids.provider]
    );
    await Promise.all([switchA, switchB]);

    const defaultResult = await pool.query(
      `
        SELECT id::text AS id
        FROM service_instances
        WHERE provider_id = $1::uuid
          AND is_default = TRUE
      `,
      [ids.provider]
    );
    checks.defaultSwitchDeterministic =
      defaultResult.rowCount === 1 &&
      [ids.instancePublic, ids.instanceGroup].includes(defaultResult.rows[0].id);

    const failedChecks = Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);

    if (failedChecks.length > 0) {
      throw new Error(`[m4:rpc:verify] failed checks: ${failedChecks.join(', ')}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks,
          ids: {
            provider: ids.provider,
            userA: ids.userA,
            adminUser: ids.adminUser,
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
