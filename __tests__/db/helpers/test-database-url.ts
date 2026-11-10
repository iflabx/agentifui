import { parse } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function resolveTestDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  directory: string = process.cwd()
): string {
  const configured =
    environment.DATABASE_URL?.trim() || environment.PGURL?.trim();
  if (configured) return configured;

  for (const candidate of ['.env.test.local', '.env.test']) {
    const filePath = path.join(directory, candidate);
    if (!existsSync(filePath)) continue;

    const parsed = parse(readFileSync(filePath, 'utf8'));
    const databaseUrl = parsed.DATABASE_URL?.trim() || parsed.PGURL?.trim();
    if (databaseUrl) return databaseUrl;
  }

  throw new Error(
    'M3 CRUD tests require an isolated test database: set DATABASE_URL or PGURL explicitly, or configure .env.test.local / .env.test. No development configuration or default database is used.'
  );
}
