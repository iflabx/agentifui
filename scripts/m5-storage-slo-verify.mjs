#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from 'pg';

loadEnv({ path: '.env.test-stack' });

const appPort = Number(process.env.M5_STORAGE_SLO_APP_PORT || 3320);
const appBase = `http://127.0.0.1:${appPort}`;
const appReadyTimeoutMs = Number(
  process.env.M5_STORAGE_SLO_READY_TIMEOUT_MS || 120000
);
const presignIterations = Number(process.env.M5_STORAGE_SLO_PRESIGN_N || 120);
const uploadIterations = Number(process.env.M5_STORAGE_SLO_UPLOAD_N || 40);
const warmupIterations = Number(process.env.M5_STORAGE_SLO_WARMUP_N || 5);
const presignP95ThresholdMs = Number(
  process.env.M5_STORAGE_SLO_PRESIGN_P95_MS || 150
);
const uploadSuccessThreshold = Number(
  process.env.M5_STORAGE_SLO_UPLOAD_SUCCESS_RATE || 0.999
);

const fallbackDatabaseUrl =
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui';
const fallbackRedisUrl = 'redis://172.20.0.1:6379/0';
const fallbackS3Endpoint = 'http://172.20.0.1:9000';

const tinyPngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7YJ7sAAAAASUVORK5CYII=',
  'base64'
);

function randomSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function assertStatus(response, expectedStatus, label) {
  if (response.status === expectedStatus) {
    return;
  }

  throw new Error(
    `${label} returned ${response.status}, expected ${expectedStatus}`
  );
}

function percentile(values, p) {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.min(sorted.length - 1, rank)];
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  updateFromResponse(response) {
    const headersWithGetSetCookie = response.headers;
    const setCookies =
      typeof headersWithGetSetCookie.getSetCookie === 'function'
        ? headersWithGetSetCookie.getSetCookie()
        : [];

    for (const line of setCookies) {
      const [pair, ...attributes] = line.split(';');
      const eqIndex = pair.indexOf('=');
      if (eqIndex < 0) {
        continue;
      }

      const name = pair.slice(0, eqIndex).trim();
      const value = pair.slice(eqIndex + 1).trim();
      if (!name) {
        continue;
      }

      const maxAgeAttr = attributes.find(attribute =>
        attribute.trim().toLowerCase().startsWith('max-age=')
      );
      const maxAge = maxAgeAttr ? Number(maxAgeAttr.split('=')[1]) : Number.NaN;
      if (Number.isFinite(maxAge) && maxAge <= 0) {
        this.cookies.delete(name);
        continue;
      }

      this.cookies.set(name, value);
    }
  }

  toHeader() {
    if (this.cookies.size === 0) {
      return '';
    }

    return Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }
}

function startProcess(command, args, options) {
  const proc = spawn(command, args, options);
  proc.stdout.on('data', chunk => {
    process.stdout.write(chunk);
  });
  proc.stderr.on('data', chunk => {
    process.stderr.write(chunk);
  });
  return proc;
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

async function requestWithCookies(jar, url, init = {}) {
  const headers = new Headers(init.headers || {});
  const cookieHeader = jar.toHeader();
  if (cookieHeader) {
    headers.set('cookie', cookieHeader);
  }

  const response = await fetch(url, {
    ...init,
    headers,
    redirect: 'manual',
  });
  jar.updateFromResponse(response);
  return response;
}

async function requestJson(jar, path, method, body) {
  const response = await requestWithCookies(jar, `${appBase}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: appBase,
      referer: `${appBase}/`,
    },
    body: JSON.stringify(body || {}),
  });

  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function signUpAndGetUserId(jar, email, password, name) {
  const signUp = await requestJson(
    jar,
    '/api/auth/better/sign-up/email',
    'POST',
    {
      email,
      password,
      name,
      callbackURL: '/chat/new',
    }
  );
  assertStatus(signUp.response, 200, 'sign-up/email');

  const session = await requestWithCookies(
    jar,
    `${appBase}/api/auth/better/get-session`,
    {
      method: 'GET',
    }
  );
  assertStatus(session, 200, 'get-session');

  const payload = await session.json().catch(() => null);
  const userId = payload?.user?.id;
  if (!userId) {
    throw new Error(`session user id missing for ${email}`);
  }

  return userId;
}

async function ensureProfileRow(client, userId, email) {
  await client.query(
    `
      INSERT INTO profiles (id, email, auth_source, role, status, created_at, updated_at)
      VALUES ($1::uuid, $2, 'native', 'user', 'active', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `,
    [userId, email]
  );
}

async function requestContentImagePresign(jar, userId, fileName) {
  const startedAt = process.hrtime.bigint();
  const result = await requestJson(
    jar,
    '/api/internal/storage/content-images/presign',
    'POST',
    {
      userId,
      fileName,
      contentType: 'image/png',
      fileSize: tinyPngBytes.byteLength,
    }
  );
  const finishedAt = process.hrtime.bigint();

  const latencyMs = Number(finishedAt - startedAt) / 1_000_000;
  return {
    latencyMs,
    response: result.response,
    payload: result.payload,
  };
}

async function requestContentImageCommit(jar, userId, path) {
  return requestJson(jar, '/api/internal/storage/content-images', 'POST', {
    userId,
    path,
  });
}

async function main() {
  const suffix = randomSuffix();
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    process.env.M5_STORAGE_SLO_DATABASE_URL?.trim() ||
    fallbackDatabaseUrl;
  const redisUrl =
    process.env.REDIS_URL?.trim() ||
    process.env.M5_STORAGE_SLO_REDIS_URL?.trim() ||
    fallbackRedisUrl;
  const s3Endpoint =
    process.env.S3_ENDPOINT?.trim() ||
    process.env.M5_STORAGE_SLO_S3_ENDPOINT?.trim() ||
    fallbackS3Endpoint;

  const appProc = startProcess('pnpm', ['next', 'dev', '-p', String(appPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NEXT_PUBLIC_APP_URL: appBase,
      BETTER_AUTH_URL: appBase,
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      S3_ENDPOINT: s3Endpoint,
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || 'minioadmin',
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
      S3_BUCKET: process.env.S3_BUCKET || 'agentifui',
      S3_ENABLE_PATH_STYLE: process.env.S3_ENABLE_PATH_STYLE || '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stopAll = async exitCode => {
    if (!appProc.killed && appProc.exitCode === null) {
      appProc.kill('SIGTERM');
      await sleep(800);
      if (appProc.exitCode === null) {
        appProc.kill('SIGKILL');
      }
    }

    process.exit(exitCode);
  };

  const dbClient = new Client({ connectionString: databaseUrl });

  try {
    await waitForServer(
      `${appBase}/api/auth/better/get-session`,
      appReadyTimeoutMs
    );

    const jar = new CookieJar();
    const email = `m5-slo-${suffix}@example.com`;
    const password = `M5SLO!${suffix}`;
    const userId = await signUpAndGetUserId(
      jar,
      email,
      password,
      `M5 SLO ${suffix}`
    );

    await dbClient.connect();
    await ensureProfileRow(dbClient, userId, email);

    for (let i = 0; i < warmupIterations; i += 1) {
      const warmupPresign = await requestContentImagePresign(
        jar,
        userId,
        `warmup-${i}.png`
      );
      assertStatus(
        warmupPresign.response,
        200,
        `content-images/presign warmup-${i}`
      );
    }

    const latencies = [];
    let presignFailures = 0;
    for (let i = 0; i < presignIterations; i += 1) {
      const presign = await requestContentImagePresign(
        jar,
        userId,
        `presign-${i}.png`
      );
      latencies.push(presign.latencyMs);
      if (presign.response.status !== 200 || !presign.payload?.uploadUrl) {
        presignFailures += 1;
      }
    }

    let uploadSuccess = 0;
    let uploadAttempts = 0;

    for (let i = 0; i < uploadIterations; i += 1) {
      const presign = await requestContentImagePresign(
        jar,
        userId,
        `upload-${i}.png`
      );
      assertStatus(presign.response, 200, `content-images/presign upload-${i}`);

      const uploadUrl = presign.payload?.uploadUrl;
      const path = presign.payload?.path;
      if (!uploadUrl || !path) {
        continue;
      }

      uploadAttempts += 1;
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/png',
        },
        body: tinyPngBytes,
      });

      if (uploadResponse.ok) {
        const commit = await requestContentImageCommit(jar, userId, path);
        if (commit.response.status === 200 && commit.payload?.success) {
          uploadSuccess += 1;
        }
      }

      await requestJson(jar, '/api/internal/storage/content-images', 'DELETE', {
        userId,
        filePath: path,
      }).catch(() => {
        // best-effort cleanup
      });
    }

    const presignP95 = percentile(latencies, 95);
    const uploadSuccessRate =
      uploadAttempts > 0 ? uploadSuccess / uploadAttempts : 0;

    const checks = {
      presignP95WithinThreshold: presignP95 <= presignP95ThresholdMs,
      uploadSuccessRateWithinThreshold:
        uploadSuccessRate >= uploadSuccessThreshold,
      presignNoFailures: presignFailures === 0,
    };

    const ok = Object.values(checks).every(Boolean);

    console.log(
      JSON.stringify(
        {
          ok,
          checks,
          metrics: {
            warmupIterations,
            presignIterations,
            uploadIterations,
            presignFailures,
            presignP95Ms: Number(presignP95.toFixed(2)),
            presignP95ThresholdMs,
            uploadAttempts,
            uploadSuccess,
            uploadSuccessRate: Number(uploadSuccessRate.toFixed(4)),
            uploadSuccessThreshold,
          },
        },
        null,
        2
      )
    );

    await stopAll(ok ? 0 : 1);
  } catch (error) {
    console.error(
      '[m5-storage-slo-verify] failed:',
      error instanceof Error ? error.message : String(error)
    );
    await stopAll(1);
  } finally {
    await dbClient.end().catch(() => {});
  }
}

main();
