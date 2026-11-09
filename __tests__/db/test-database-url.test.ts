/** @jest-environment node */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveTestDatabaseUrl } from './helpers/test-database-url';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'agentifui-test-database-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

test('prefers an explicitly supplied DATABASE_URL over PGURL and files', () => {
  writeFileSync(path.join(directory, '.env.test'), 'DATABASE_URL=file-fixture');
  const environment = {
    DATABASE_URL: '  explicit-fixture  ',
    PGURL: 'fallback-fixture',
  };

  expect(resolveTestDatabaseUrl(environment, directory)).toBe(
    'explicit-fixture'
  );
  expect(environment.DATABASE_URL).toBe('  explicit-fixture  ');
});

test('accepts explicit PGURL when DATABASE_URL is blank', () => {
  expect(
    resolveTestDatabaseUrl(
      { DATABASE_URL: ' ', PGURL: ' pgurl-fixture ' },
      directory
    )
  ).toBe('pgurl-fixture');
});

test.each(['.env.test.local', '.env.test'])(
  'reads only explicit test profile %s',
  file => {
    writeFileSync(
      path.join(directory, file),
      'DATABASE_URL=" test-fixture "\n'
    );

    expect(resolveTestDatabaseUrl({}, directory)).toBe('test-fixture');
  }
);

test('prefers .env.test.local over .env.test', () => {
  writeFileSync(
    path.join(directory, '.env.test.local'),
    'PGURL=local-test-fixture\n'
  );
  writeFileSync(
    path.join(directory, '.env.test'),
    'DATABASE_URL=base-test-fixture\n'
  );

  expect(resolveTestDatabaseUrl({}, directory)).toBe('local-test-fixture');
});

test('continues to .env.test when the local test profile has no database', () => {
  writeFileSync(path.join(directory, '.env.test.local'), 'DATABASE_URL=" "\n');
  writeFileSync(path.join(directory, '.env.test'), 'PGURL=base-test-fixture\n');

  expect(resolveTestDatabaseUrl({}, directory)).toBe('base-test-fixture');
});

test('does not fall back to development, production or unqualified env files', () => {
  for (const file of ['.env.dev', '.env.prod', '.env.local', '.env']) {
    writeFileSync(
      path.join(directory, file),
      'DATABASE_URL=private-fixture-do-not-use\n'
    );
  }

  expect(() => resolveTestDatabaseUrl({}, directory)).toThrow(
    'isolated test database'
  );
  expect(() => resolveTestDatabaseUrl({}, directory)).not.toThrow(
    'private-fixture-do-not-use'
  );
});

test('fails explicitly rather than choosing a default connection', () => {
  expect(() =>
    resolveTestDatabaseUrl({ DATABASE_URL: ' ', PGURL: '' }, directory)
  ).toThrow('No development configuration or default database is used');
});
