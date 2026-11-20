/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { resolveTestDatabaseUrl } from './helpers/test-database-url';

test('real Better Auth PostgreSQL/Redis adapter respects session revocation across instances', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'helpers/better-auth-revocation.mjs')],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: resolveTestDatabaseUrl() },
      encoding: 'utf8',
      timeout: 30000,
    }
  );
  expect({
    status: result.status,
    error: result.error?.message,
    output: result.stdout,
    stderr: result.stderr,
  }).toMatchObject({ status: 0 });
  expect(result.stdout).toContain('PASS real Better Auth');
});
