#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';
import { Client as PgClient } from 'pg';
import { createClient as createRedisClient } from 'redis';

loadEnv({ path: '.env.test-stack' });

const databaseUrl =
  process.env.DATABASE_URL?.trim() ||
  process.env.PGURL?.trim() ||
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui';
const redisUrl =
  process.env.REDIS_URL?.trim() || 'redis://172.20.0.1:6379/0';
const s3Endpoint = (
  process.env.S3_ENDPOINT?.trim() || 'http://172.20.0.1:9000'
).replace(/\/$/, '');
const s3Bucket = process.env.S3_BUCKET?.trim() || 'agentifui';
const authBase =
  process.env.M1_AUTH_BASE_URL?.trim() ||
  process.env.BETTER_AUTH_URL?.trim() ||
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  '';
const authPort = Number(process.env.M1_AUTH_HEALTH_PORT || 3311);
const authTimeoutMs = Number(process.env.M1_AUTH_HEALTH_TIMEOUT_MS || 120000);
const authFallbackBase = `http://127.0.0.1:${authPort}`;

function assertStatusOk(status, allowed, label) {
  if (!allowed.includes(status)) {
    throw new Error(
      `${label} returned ${status}, expected ${allowed.join(' or ')}`
    );
  }
}

async function checkPostgres() {
  const client = new PgClient({ connectionString: databaseUrl });
  await client.connect();
  await client.query('SELECT 1');
  await client.end();
}

async function checkRedis() {
  const client = createRedisClient({ url: redisUrl });
  client.on('error', () => {});
  await client.connect();
  const pong = await client.ping();
  if (pong !== 'PONG') {
    throw new Error(`Unexpected redis ping response: ${pong}`);
  }
  await client.quit();
}

async function checkMinio() {
  const liveResponse = await fetch(`${s3Endpoint}/minio/health/live`, {
    method: 'GET',
  });
  if (!liveResponse.ok) {
    throw new Error(
      `MinIO live health failed with status ${liveResponse.status}`
    );
  }

  const bucketHead = await fetch(
    `${s3Endpoint}/${encodeURIComponent(s3Bucket)}`,
    {
      method: 'HEAD',
    }
  );
  if (bucketHead.status === 404) {
    throw new Error(`MinIO bucket "${s3Bucket}" does not exist`);
  }

  assertStatusOk(bucketHead.status, [200, 403], 'MinIO bucket probe');
}

async function checkAuthApi(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/better/get-session`, {
    method: 'GET',
    redirect: 'manual',
  });
  assertStatusOk(response.status, [200, 401], 'Auth get-session');
}

async function waitForServer(url, timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
      });
      if (response.status > 0) {
        return;
      }
    } catch {}
    await sleep(500);
  }

  throw new Error(`Server not ready in ${timeoutMs}ms: ${url}`);
}

async function runEphemeralAuthCheck() {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    AUTH_BACKEND: process.env.AUTH_BACKEND || 'better-auth',
    NEXT_PUBLIC_APP_URL: authFallbackBase,
    BETTER_AUTH_URL: authFallbackBase,
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET || 'm1-runtime-health-secret',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    S3_ENDPOINT: s3Endpoint,
    S3_BUCKET: s3Bucket,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || 'minioadmin',
    S3_SECRET_ACCESS_KEY:
      process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
    S3_ENABLE_PATH_STYLE: process.env.S3_ENABLE_PATH_STYLE || '1',
  };

  const child = spawn('pnpm', ['next', 'dev', '-p', String(authPort)], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', chunk => {
    output += chunk.toString();
    if (output.length > 8000) {
      output = output.slice(-8000);
    }
  });
  child.stderr.on('data', chunk => {
    output += chunk.toString();
    if (output.length > 8000) {
      output = output.slice(-8000);
    }
  });

  try {
    await waitForServer(
      `${authFallbackBase}/api/auth/better/get-session`,
      authTimeoutMs
    );
    await checkAuthApi(authFallbackBase);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}\n[auth-check-log-tail]\n${output}`);
  } finally {
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGTERM');
      await sleep(1000);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }
  }
}

async function checkAuthHealth() {
  if (authBase) {
    await checkAuthApi(authBase);
    return;
  }

  await runEphemeralAuthCheck();
}

async function main() {
  const checks = [];

  await checkPostgres();
  checks.push({ check: 'postgres', ok: true });

  await checkRedis();
  checks.push({ check: 'redis', ok: true });

  await checkMinio();
  checks.push({ check: 'minio', ok: true });

  await checkAuthHealth();
  checks.push({ check: 'auth', ok: true });

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks,
        env: {
          DATABASE_URL: databaseUrl,
          REDIS_URL: redisUrl,
          S3_ENDPOINT: s3Endpoint,
          AUTH_BASE_URL: authBase || authFallbackBase,
        },
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error(
    '[m1-runtime-health] failed:',
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
