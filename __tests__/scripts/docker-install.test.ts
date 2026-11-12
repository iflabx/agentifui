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

test.each([
  ['minio', 'minio', 'AGENTIF_MINIO_IMAGE', 'agentifui-minio:source-9e49d5e7'],
  ['storage-init', 'mc', 'AGENTIF_MC_IMAGE', 'agentifui-mc:source-7394ce0d'],
])(
  'Compose builds %s from pinned official source without registry pulls',
  (service, target, variable, image) => {
    const compose = read('compose.yaml');
    const body = compose.match(
      new RegExp(
        `^  ${service}:\\n[\\s\\S]*?(?=^  [\\w-]+:|$(?![\\s\\S]))`,
        'm'
      )
    )?.[0];
    expect(body).toBeDefined();
    expect(body).toContain(`image: \${${variable}:-${image}}`);
    expect(body).toContain('pull_policy: never');
    expect(body).toMatch(
      new RegExp(
        `build:\\n\\s+context: \\.\\n\\s+dockerfile: docker/Dockerfile\\.storage\\n\\s+target: ${target}\\n`
      )
    );
    expect(compose).not.toMatch(/(?:quay\.io\/)?minio\/(?:minio|mc)[:@]/);
    if (service === 'minio') {
      expect(body).toContain(
        "command: [server, /data, --console-address, ':9001']"
      );
      expect(body).toContain('objects:/data');
      expect(body).toContain('MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-}');
    } else {
      expect(body).toContain(
        'entrypoint: [sh, /scripts/docker-storage-init.sh]'
      );
      expect(body).toContain(
        './scripts/docker-storage-init.sh:/scripts/docker-storage-init.sh:ro'
      );
      expect(body).toContain('S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY:-}');
    }
  }
);

test('storage images compile official commits matching CI with cached static Go builds', () => {
  const storage = read('docker/Dockerfile.storage');
  const workflow = read('.github/workflows/ci.yml');
  expect(storage).toContain('FROM golang:1.24.8-bookworm AS builder');
  expect(workflow).toContain("GO_VERSION: '1.24.8'");
  expect(storage).toContain('CGO_ENABLED=0');
  expect(storage).toContain('GOBIN=/out');
  expect(storage).toContain('GOTOOLCHAIN=local');
  expect(storage).toContain('GOMODCACHE=/go/pkg/mod');
  expect(storage).toContain('GOCACHE=/root/.cache/go-build');
  expect(storage).toContain('--mount=type=cache,target=/go/pkg/mod');
  expect(storage).toContain('--mount=type=cache,target=/root/.cache/go-build');
  for (const [name, commit] of [
    ['MINIO_COMMIT', '9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a'],
    ['MC_COMMIT', '7394ce0dd2a80935aded936b09fa12cbb3cb8096'],
  ]) {
    expect(storage).toContain(`${name}=${commit}`);
    expect(workflow).toContain(`${name}: '${commit}'`);
  }
  for (const [module, variable] of [
    ['minio', 'MINIO_COMMIT'],
    ['mc', 'MC_COMMIT'],
  ]) {
    expect(storage).toContain(
      `go install "github.com/minio/${module}@$${variable}"`
    );
    expect(storage).toContain(
      `go list -m -f '{{.Dir}}' "github.com/minio/${module}@$${variable}"`
    );
    expect(storage).toContain(`test -n "$${module}_dir"`);
    expect(storage).toContain(`test -s "$${module}_dir/LICENSE"`);
    expect(storage).toContain(
      `cp "$${module}_dir/LICENSE" /out/licenses/${module}/LICENSE`
    );
  }
  expect(storage).not.toMatch(/curl|wget|COPY \. \./);
});

test('storage runtime targets include CA and upstream licenses without real configuration', () => {
  const storage = read('docker/Dockerfile.storage');
  expect(storage).toContain('FROM alpine:3.22 AS runtime');
  expect(storage).toContain(
    'COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt'
  );
  expect(storage).toContain('ENV HOME=/tmp');
  const minio = storage
    .split('FROM runtime AS minio\n')[1]
    .split('FROM runtime AS mc\n')[0];
  const mc = storage.split('FROM runtime AS mc\n')[1];
  expect(minio).toContain('RUN mkdir -p /data && chown 1000:1000 /data');
  expect(minio).toContain('USER 1000:1000');
  expect(minio).toContain('WORKDIR /data');
  expect(mc).toContain('USER 0:0');
  for (const [module, body] of [
    ['minio', minio],
    ['mc', mc],
  ]) {
    expect(body).toContain(
      `COPY --from=builder /out/${module} /usr/local/bin/${module}`
    );
    expect(body).toContain(
      `COPY --from=builder /out/licenses/${module}/LICENSE /usr/share/licenses/${module}/LICENSE`
    );
    expect(body).toContain(
      `org.opencontainers.image.source="https://github.com/minio/${module}"`
    );
    expect(body).toContain(
      'org.opencontainers.image.licenses="AGPL-3.0-or-later"'
    );
    expect(body).toContain(`ENTRYPOINT ["/usr/local/bin/${module}"]`);
  }
  expect(storage).not.toMatch(
    /MINIO_ROOT_|S3_SECRET|COPY[^\n]*\.env|COPY \. \./
  );
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
