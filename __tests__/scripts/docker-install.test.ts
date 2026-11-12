/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const validEnvironment = {
  NODE_ENV: 'test' as const,
  PATH: process.env.PATH,
  DATABASE_URL: 'postgresql://app:fixture@postgres:5432/fixture',
  REDIS_URL: 'redis://redis:6379/1',
  AGENTIF_RUNTIME_DIR: '/data/runtime',
  BETTER_AUTH_URL: 'https://chat.example.com',
  S3_ENDPOINT: 'http://minio:9000',
  S3_PRESIGN_ENDPOINT: 'https://storage.example.com',
  S3_BUCKET: 'fixture',
  S3_ACCESS_KEY_ID: 'fixture',
  S3_SECRET_ACCESS_KEY: 'fixture-only-'.repeat(4),
  BETTER_AUTH_SECRET: 'fixture-'.repeat(8),
  API_ENCRYPTION_KEY: 'ab'.repeat(32),
  APP_RLS_STRICT_MODE: '1',
  AUTH_EMAIL_VERIFICATION_MODE: 'smtp',
  AUTH_RESET_PASSWORD_MODE: 'smtp',
  SMTP_HOST: 'smtp.example.com',
  SMTP_FROM: 'no-reply@example.com',
};

function validate(environment: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, ['scripts/check-docker-env.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...validEnvironment, ...environment },
  });
}

test('accepts a complete synthetic runtime environment without an env file', () => {
  expect(validate().status).toBe(0);
});

test.each([
  ['BETTER_AUTH_SECRET', 'build-only-not-a-runtime-secret-00000000'],
  ['BETTER_AUTH_SECRET', 'replace_with_32_plus_random_chars'],
  ['API_ENCRYPTION_KEY', 'CHANGE_ME'],
  ['APP_RLS_STRICT_MODE', '0'],
  ['S3_PRESIGN_ENDPOINT', ''],
  ['S3_SECRET_ACCESS_KEY', 'minioadmin'],
  ['S3_ENDPOINT', 'not a URL'],
  ['DATABASE_URL', ''],
  ['MIGRATOR_DATABASE_URL', 'postgresql://owner@postgres/db'],
  ['POSTGRES_PASSWORD', 'must-not-reach-app'],
  ['AUTH_EMAIL_VERIFICATION_MODE', 'dev-log'],
  ['AUTH_RESET_PASSWORD_MODE', 'disabled'],
  ['SMTP_HOST', ''],
])('rejects unsafe or missing %s without printing its value', (name, value) => {
  const result = validate({ [name]: value });
  expect(result.status).toBe(1);
  if (/SECRET|PASSWORD|DATABASE_URL/.test(name) && value)
    expect(result.stderr).not.toContain(value);
});

test('application startup never initializes or migrates data', () => {
  const entry = read('scripts/docker-entrypoint.sh');
  const startup = entry.split('web|api)')[1].split(';;')[0];
  expect(startup).toContain('check-docker-env.mjs');
  expect(startup).toContain('prepare-runtime-content.mjs --check');
  expect(startup).not.toMatch(/--init|--deploy|docker-init-db/);
  expect(startup).toContain('exec node');
});

test('Compose does not forward administrative credentials to applications', () => {
  const compose = read('compose.yaml');
  const environment = compose.split('x-environment:')[1].split('x-app:')[0];
  expect(environment).not.toMatch(
    /MIGRATOR_DATABASE_URL|POSTGRES_PASSWORD|MINIO_ROOT_/
  );
  expect(compose).not.toContain('env_file:');
  expect(compose).not.toContain('depends_on:');
  expect(compose).toContain('postgres:/var/lib/postgresql');
  expect(compose).toMatch(/S3_PUBLIC_READ_ENABLED: ['"]false['"]/);
});

test('database initialization refuses existing installations before applying SQL', () => {
  const initialize = read('scripts/docker-init-db.mjs');
  expect(initialize.indexOf('Refusing initialization')).toBeLessThan(
    initialize.indexOf('for (const migration')
  );
  expect(
    initialize.indexOf('Refusing to modify an existing app role')
  ).toBeLessThan(initialize.indexOf('for (const migration'));
  expect(initialize).toContain('pg_advisory_xact_lock');
  expect(initialize).toContain('NOBYPASSRLS');
  expect(initialize).toContain("client.query('ROLLBACK')");
  expect(initialize).not.toContain('ALTER ROLE');
});

test('Docker context excludes private files and runtime defaults contain no build credentials', () => {
  const ignore = read('.dockerignore');
  for (const pattern of [
    '**/.env.*',
    '**/local_docs',
    '**/local_scripts',
    '**/runtime',
    '.git',
  ])
    expect(ignore).toContain(pattern);
  const runtime = read('Dockerfile').split('FROM dependencies AS runtime')[1];
  expect(read('Dockerfile')).toContain('FROM scratch AS runtime-content');
  expect(read('Dockerfile')).toContain('--network=none');
  expect(runtime).toContain('USER node');
  for (const line of runtime
    .split('\n')
    .filter(line => line.startsWith('COPY ')))
    expect(line).toContain('--chown=node:node');
  expect(runtime).toContain('/app/lib/config/branding.js');
  expect(runtime).not.toMatch(/BETTER_AUTH_SECRET|DATABASE_URL|COPY \. \./);
});
