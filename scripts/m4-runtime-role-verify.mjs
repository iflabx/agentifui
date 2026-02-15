import assert from 'node:assert/strict';

import { Pool } from 'pg';

const fallbackDatabaseUrl =
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui';

const runtimeDatabaseUrl =
  process.env.DATABASE_URL?.trim() ||
  process.env.PGURL?.trim() ||
  process.env.M4_RUNTIME_DATABASE_URL?.trim() ||
  fallbackDatabaseUrl;

const migratorDatabaseUrl =
  process.env.MIGRATOR_DATABASE_URL?.trim() ||
  process.env.M4_MIGRATOR_DATABASE_URL?.trim() ||
  process.env.PG_MIGRATOR_URL?.trim() ||
  '';

function isTruthy(value) {
  const normalized = (value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

const enforceRoleSplit = !isTruthy(process.env.M4_ALLOW_SINGLE_DB_ROLE);

async function readCurrentRoleInfo(connectionString) {
  const pool = new Pool({ connectionString });
  try {
    const result = await pool.query(
      `
        SELECT
          current_user AS role_name,
          r.rolsuper,
          r.rolbypassrls
        FROM pg_roles r
        WHERE r.rolname = current_user
      `
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Unable to inspect current database role.');
    }

    return {
      roleName: String(row.role_name),
      isSuperuser: Boolean(row.rolsuper),
      bypassRls: Boolean(row.rolbypassrls),
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  const runtime = await readCurrentRoleInfo(runtimeDatabaseUrl);

  assert.equal(
    runtime.isSuperuser,
    false,
    '[m4:runtime-role:verify] runtime role must not be superuser'
  );
  assert.equal(
    runtime.bypassRls,
    false,
    '[m4:runtime-role:verify] runtime role must not have BYPASSRLS'
  );

  let migrator = null;
  if (migratorDatabaseUrl) {
    migrator = await readCurrentRoleInfo(migratorDatabaseUrl);
  } else if (enforceRoleSplit) {
    throw new Error(
      '[m4:runtime-role:verify] MIGRATOR_DATABASE_URL is required when role split is enforced'
    );
  }

  if (enforceRoleSplit && migrator) {
    assert.notEqual(
      runtime.roleName,
      migrator.roleName,
      '[m4:runtime-role:verify] runtime role must differ from migrator role'
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtimeRole: runtime.roleName,
        runtimeRoleFlags: {
          rolsuper: runtime.isSuperuser,
          rolbypassrls: runtime.bypassRls,
        },
        migratorRole: migrator?.roleName || null,
        enforceRoleSplit,
      },
      null,
      2
    )
  );
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
