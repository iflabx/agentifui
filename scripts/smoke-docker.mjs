import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArguments(args) {
  const options = { image: '', port: 23300 };
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!value || !['--image', '--web-port'].includes(name))
      throw new Error(
        'Usage: node scripts/smoke-docker.mjs --image IMAGE [--web-port PORT]'
      );
    if (name === '--image') options.image = value;
    else options.port = Number(value);
  }
  if (!options.image || options.image.startsWith('-'))
    throw new Error('An existing local --image is required');
  if (
    !Number.isInteger(options.port) ||
    options.port < 1024 ||
    options.port > 65535
  )
    throw new Error('--web-port must be an integer from 1024 to 65535');
  return options;
}

export function createEnvironment(image, port, project) {
  const origin = `http://127.0.0.1:${port}`;
  const password = () => randomBytes(24).toString('hex');
  const appPassword = password();
  const ownerPassword = password();
  const redisPassword = password();
  return {
    COMPOSE_PROJECT_NAME: project,
    AGENTIF_IMAGE: image,
    WEB_PORT: String(port),
    WEB_BIND_IP: '127.0.0.1',
    STORAGE_PORT: '0',
    STORAGE_BIND_IP: '127.0.0.1',
    NEXT_PUBLIC_APP_URL: origin,
    BETTER_AUTH_URL: origin,
    CORS_ALLOWED_ORIGINS: origin,
    BETTER_AUTH_SECRET: password(),
    API_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    POSTGRES_DB: 'smoke',
    POSTGRES_USER: 'smoke_owner',
    POSTGRES_PASSWORD: ownerPassword,
    APP_DATABASE_ROLE: 'smoke_app',
    APP_DATABASE_PASSWORD: appPassword,
    DATABASE_URL: `postgresql://smoke_app:${appPassword}@postgres:5432/smoke`,
    MIGRATOR_DATABASE_URL: `postgresql://smoke_owner:${ownerPassword}@postgres:5432/smoke`,
    REDIS_PASSWORD: redisPassword,
    REDIS_URL: `redis://:${redisPassword}@redis:6379/1`,
    REDIS_PREFIX: project,
    MINIO_ROOT_USER: 'smoke_owner',
    MINIO_ROOT_PASSWORD: password(),
    S3_ENDPOINT: 'http://minio:9000',
    S3_PRESIGN_ENDPOINT: origin,
    S3_BUCKET: 'smoke',
    S3_ACCESS_KEY_ID: 'smoke_storage',
    S3_SECRET_ACCESS_KEY: password(),
    AUTH_EMAIL_VERIFICATION_MODE: 'smtp',
    AUTH_RESET_PASSWORD_MODE: 'smtp',
    SMTP_HOST: 'smtp.example.invalid',
    SMTP_FROM: 'smoke@example.invalid',
    NEXT_PUBLIC_GITHUB_LOGIN_ENABLED: 'false',
    NEXT_PUBLIC_SSO_ONLY_MODE: 'false',
    PG_POOL_MAX: '2',
  };
}

export function redact(text, environment) {
  let result = String(text);
  for (const [name, value] of Object.entries(environment)) {
    if (
      /PASSWORD|SECRET|ENCRYPTION_KEY|DATABASE_URL|REDIS_URL/.test(name) &&
      value
    )
      result = result.split(value).join('[redacted]');
  }
  return result;
}

async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

export async function smokeDocker(options) {
  const project = `agentifui-smoke-${randomBytes(8).toString('hex')}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${project}-`));
  fs.chmodSync(directory, 0o700);
  const environment = createEnvironment(options.image, options.port, project);
  const childEnvironment = Object.fromEntries(
    [
      'PATH',
      'HOME',
      'DOCKER_HOST',
      'DOCKER_CONTEXT',
      'DOCKER_CONFIG',
      'DOCKER_TLS_VERIFY',
      'DOCKER_CERT_PATH',
    ]
      .filter(name => process.env[name])
      .map(name => [name, process.env[name]])
  );
  const docker = args => {
    try {
      return execFileSync('docker', args, {
        cwd: root,
        env: childEnvironment,
        encoding: 'utf8',
        timeout: 300000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch (error) {
      throw new Error(redact(error.stderr || error.message, environment));
    }
  };
  const envFile = path.join(directory, 'smoke.env');
  const composeArgs = [
    'compose',
    '-p',
    project,
    '--env-file',
    envFile,
    '-f',
    path.join(root, 'compose.yaml'),
  ];
  const compose = args => docker([...composeArgs, ...args]);
  const snapshot = () => {
    const ids = docker(['ps', '-aq']).split(/\s+/).filter(Boolean);
    return ids.length
      ? JSON.parse(docker(['inspect', ...ids])).map(item => ({
          id: item.Id,
          running: item.State.Running,
          started: item.State.StartedAt,
          restarts: item.RestartCount,
        }))
      : [];
  };
  let baseline;
  let owned = false;
  let failure;
  try {
    docker(['image', 'inspect', options.image]);
    baseline = snapshot();
    await checkPort(options.port);
    assert.equal(
      docker([
        'ps',
        '-aq',
        '--filter',
        `label=com.docker.compose.project=${project}`,
      ]),
      ''
    );
    fs.writeFileSync(
      envFile,
      Object.entries(environment)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n',
      { mode: 0o600 }
    );
    compose(['config', '--quiet']);
    owned = true;
    console.log('Starting an isolated Docker smoke project');
    compose([
      '--profile',
      'data',
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '120',
      'postgres',
      'redis',
    ]);
    compose(['--profile', 'data', 'up', '-d', 'minio']);
    compose([
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'node',
      'content',
      '-e',
      "(async()=>{for(let attempt=0;attempt<60;attempt++){try{if((await fetch('http://minio:9000/minio/health/live',{signal:AbortSignal.timeout(2000)})).ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,1000))}process.exit(1)})()",
    ]);
    compose(['run', '--rm', '--no-deps', 'db-init']);
    compose(['run', '--rm', '--no-deps', 'storage-init']);
    compose(['run', '--rm', '--no-deps', 'content', 'content-init']);
    compose([
      'up',
      '-d',
      '--no-build',
      '--wait',
      '--wait-timeout',
      '180',
      'web',
      'api',
    ]);
    compose([
      'exec',
      '-T',
      'api',
      'node',
      '-e',
      "fetch('http://127.0.0.1:3010/healthz').then(async response=>{if(!response.ok)process.exit(1);await response.text()}).catch(()=>process.exit(1))",
    ]);
    const origin = environment.NEXT_PUBLIC_APP_URL;
    const request = pathname =>
      fetch(origin + pathname, { signal: AbortSignal.timeout(15000) });
    assert.equal((await request('/api/auth/better/get-session')).status, 200);
    assert.equal((await request('/api/internal/profile')).status, 401);
    const login = await request('/login');
    assert.equal(login.status, 200);
    const html = await login.text();
    const asset = html.match(
      /(?:src|href)="([^"\s]*\/_next\/static\/[^"\s]+\.(?:js|css))"/
    );
    assert(asset, 'Login page must reference built static assets');
    const assetUrl = new URL(asset[1].replaceAll('&amp;', '&'), origin);
    assert.equal(assetUrl.origin, origin);
    assert.equal(
      (await request(assetUrl.pathname + assetUrl.search)).status,
      200
    );
    console.log(
      'Docker smoke passed: Web/API health, login page, static asset and anonymous access control'
    );
  } catch (error) {
    failure = error;
    if (owned) {
      try {
        console.error(
          redact(
            compose(['logs', '--no-color', '--tail', '60', 'web', 'api']),
            environment
          )
        );
      } catch {}
    }
  } finally {
    try {
      if (owned)
        compose([
          '--profile',
          'data',
          '--profile',
          'tools',
          'down',
          '--volumes',
          '--timeout',
          '10',
        ]);
      if (baseline) {
        const current = new Map(snapshot().map(item => [item.id, item]));
        for (const item of baseline)
          assert.deepEqual(
            current.get(item.id),
            item,
            'An existing container changed during validation'
          );
        console.log(
          'Existing containers retain their IDs, running state, start times and restart counts'
        );
      }
    } catch (error) {
      failure = failure
        ? new AggregateError(
            [failure, error],
            'Smoke and cleanup checks failed'
          )
        : error;
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
  if (failure) throw failure;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await smokeDocker(parseArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(`[docker-smoke] ${error.message}`);
    process.exitCode = 1;
  }
}
