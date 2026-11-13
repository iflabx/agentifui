import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.MIGRATOR_DATABASE_URL,
});
const role = process.env.APP_DATABASE_ROLE;
const password = process.env.APP_DATABASE_PASSWORD;
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => `'${value.replaceAll("'", "''")}'`;

try {
  if (
    !process.env.MIGRATOR_DATABASE_URL ||
    !role ||
    !password ||
    password.length < 24 ||
    /replace|change.me/i.test(password)
  )
    throw new Error(
      'Migration URL, app role and a 24+ character app password are required'
    );
  await client.connect();
  await client.query('BEGIN');
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('agentifui:fresh-install'))"
  );
  const existing = await client.query(
    `SELECT 1 FROM pg_class JOIN pg_namespace ON pg_namespace.oid = relnamespace WHERE nspname IN ('public', 'auth') AND relkind IN ('r', 'p', 'v', 'm', 'S') LIMIT 1`
  );
  if (existing.rowCount)
    throw new Error(
      'Refusing initialization of a nonempty database; apply reviewed pending migrations instead'
    );
  const existingRole = await client.query(
    'SELECT 1 FROM pg_roles WHERE rolname = $1',
    [role]
  );
  if (existingRole.rowCount)
    throw new Error(
      'Refusing to modify an existing app role; use a new installation role'
    );
  const directory = fileURLToPath(
    new URL('../database/migrations/', import.meta.url)
  );
  const migrations = (await fs.readdir(directory))
    .filter(name => name.endsWith('.sql'))
    .sort();
  if (!migrations.length) throw new Error('No migrations found');
  for (const migration of migrations) {
    const sql = await fs.readFile(`${directory}/${migration}`, 'utf8');
    await client.query(
      sql.replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '')
    );
    console.log(`[db-init] applied ${migration}`);
  }
  await client.query(
    `CREATE ROLE ${identifier(role)} LOGIN PASSWORD ${literal(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS`
  );
  const database = (await client.query('SELECT current_database() AS name'))
    .rows[0].name;
  await client.query(
    `GRANT CONNECT ON DATABASE ${identifier(database)} TO ${identifier(role)}`
  );
  await client.query(
    `GRANT USAGE ON SCHEMA public, auth TO ${identifier(role)}`
  );
  for (const schema of ['public', 'auth']) {
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${identifier(role)}`
    );
    await client.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${identifier(role)}`
    );
    await client.query(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} TO ${identifier(role)}`
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${identifier(role)}`
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT USAGE, SELECT ON SEQUENCES TO ${identifier(role)}`
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT EXECUTE ON FUNCTIONS TO ${identifier(role)}`
    );
  }
  await client.query('COMMIT');
  console.log(
    '[db-init] Fresh installation ready; keep this credential out of Web/API'
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`[db-init] ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
