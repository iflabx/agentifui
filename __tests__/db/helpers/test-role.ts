import type { Pool } from 'pg';

async function roleDdl(database: Pool, role: string, statements: string[]) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role))
    throw new Error('Invalid test role identifier');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(1735289204, 1)');
    for (const statement of statements) await client.query(statement);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createTestRole(database: Pool, role: string) {
  return roleDdl(database, role, [
    `CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`,
    `GRANT USAGE ON SCHEMA public TO "${role}"`,
    `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
    `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`,
  ]);
}

export function dropTestRole(database: Pool, role: string) {
  return roleDdl(database, role, [
    `DROP OWNED BY "${role}"`,
    `DROP ROLE "${role}"`,
  ]);
}
