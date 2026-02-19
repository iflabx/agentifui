#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from 'pg';

loadEnv({ path: '.env.test-stack' });

const appPort = Number(process.env.M9_DIFY_REAL_APP_PORT || 3324);
const appBase = `http://127.0.0.1:${appPort}`;
const useFastifyProxy = process.env.M9_DIFY_REAL_USE_FASTIFY_PROXY !== '0';
const fastifyPort = Number(process.env.M9_DIFY_REAL_FASTIFY_PORT || 3424);
const fastifyBase = `http://127.0.0.1:${fastifyPort}`;
const appReadyTimeoutMs = Number(
  process.env.M9_DIFY_REAL_READY_TIMEOUT_MS || 120000
);
const appStartRetryCount = Math.max(
  1,
  Number(process.env.M9_DIFY_REAL_APP_START_RETRIES || 2)
);
const runExecutionProbe = parseBooleanEnv(
  process.env.M9_DIFY_REAL_RUN_EXEC,
  true
);

const fallbackDatabaseUrl =
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui';
const fallbackRedisUrl = 'redis://172.20.0.1:6379/0';
const fallbackS3Endpoint = 'http://172.20.0.1:9000';
const defaultFastifyProxyPrefixes = [
  '/api/dify',
  '/api/internal/data',
  '/api/internal/apps',
  '/api/internal/profile',
  '/api/internal/realtime',
  '/api/internal/storage',
  '/api/internal/ops/dify-resilience',
  '/api/internal/dify-config',
  '/api/internal/auth/local-password',
  '/api/internal/fastify-health',
  '/api/admin',
  '/api/translations',
];

function parseBooleanEnv(value, fallbackValue) {
  if (!value) {
    return fallbackValue;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallbackValue;
}

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

function startProcess(command, args, options) {
  const proc = spawn(command, args, options);
  const stderrLines = [];
  proc.stdout.on('data', chunk => {
    process.stdout.write(chunk);
  });
  proc.stderr.on('data', chunk => {
    const text = chunk.toString();
    process.stderr.write(text);
    stderrLines.push(text.trim());
    if (stderrLines.length > 80) {
      stderrLines.shift();
    }
  });
  proc.__stderrLines = stderrLines;
  return proc;
}

async function waitForExit(proc, timeoutMs = 5000) {
  if (!proc || proc.exitCode !== null) {
    return proc?.exitCode ?? null;
  }

  return new Promise(resolve => {
    let settled = false;
    const onExit = code => {
      if (settled) return;
      settled = true;
      resolve(code);
    };

    proc.once('exit', onExit);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.removeListener('exit', onExit);
      resolve(null);
    }, timeoutMs);
  });
}

async function terminateProcess(proc) {
  if (!proc || proc.exitCode !== null) {
    return;
  }

  proc.kill('SIGTERM');
  const termCode = await waitForExit(proc, 3000);
  if (termCode !== null) {
    return;
  }

  proc.kill('SIGKILL');
  await waitForExit(proc, 2000);
}

function formatStartupError(proc, baseMessage) {
  const stderrLines = Array.isArray(proc?.__stderrLines) ? proc.__stderrLines : [];
  const tail = stderrLines.slice(-6).join('\n');
  if (!tail) {
    return baseMessage;
  }
  return `${baseMessage}\n[stderr tail]\n${tail}`;
}

async function waitForServer(url, proc, timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (proc && proc.exitCode !== null) {
      throw new Error(
        formatStartupError(
          proc,
          `App process exited early with code ${proc.exitCode}`
        )
      );
    }

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

  throw new Error(
    formatStartupError(proc, `Server not ready in ${timeoutMs}ms: ${url}`)
  );
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

async function requestJson(jar, path, method, body, originBase) {
  const response = await requestWithCookies(jar, `${originBase}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: originBase,
      referer: `${originBase}/`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function signUpAndGetUserId(jar, email, password, name, originBase) {
  const signUp = await requestJson(
    jar,
    '/api/auth/better/sign-up/email',
    'POST',
    {
      email,
      password,
      name,
      callbackURL: '/chat/new',
    },
    originBase
  );
  assertStatus(signUp.response, 200, 'sign-up/email');

  const session = await requestWithCookies(
    jar,
    `${originBase}/api/auth/better/get-session`,
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

async function ensureAdminProfile(client, userId, email) {
  await client.query(
    `
      INSERT INTO profiles (
        id,
        email,
        auth_source,
        role,
        status,
        created_at,
        updated_at
      ) VALUES (
        $1::uuid,
        $2,
        'better-auth',
        'admin',
        'active',
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        role = 'admin',
        status = 'active',
        updated_at = NOW()
    `,
    [userId, email]
  );
}

async function resolveTargetInstanceId(jar, originBase) {
  const configuredInstanceId =
    process.env.M9_DIFY_REAL_PROVIDER_INSTANCE_ID?.trim() || '';

  if (configuredInstanceId) {
    const probe = await requestWithCookies(
      jar,
      `${originBase}/api/internal/apps?instanceId=${encodeURIComponent(configuredInstanceId)}`,
      {
        method: 'GET',
        headers: {
          origin: originBase,
          referer: `${originBase}/`,
        },
      }
    );
    if (probe.headers.get('x-agentifui-next-handler') === 'next-disabled') {
      throw new Error(
        'Next disabled stub responded for /api/internal/apps. Fastify proxy/cutover is not active.'
      );
    }
    if (probe.status !== 200) {
      throw new Error(
        `Configured instanceId '${configuredInstanceId}' is not accessible (status=${probe.status})`
      );
    }
    return {
      instanceId: configuredInstanceId,
      source: 'env',
    };
  }

  const response = await requestWithCookies(
    jar,
    `${originBase}/api/internal/apps?mode=default`,
    {
      method: 'GET',
      headers: {
        origin: originBase,
        referer: `${originBase}/`,
      },
    }
  );
  if (response.headers.get('x-agentifui-next-handler') === 'next-disabled') {
    throw new Error(
      'Next disabled stub responded for /api/internal/apps. Fastify proxy/cutover is not active.'
    );
  }
  assertStatus(response, 200, 'internal apps default');

  const payload = await response.json().catch(() => null);
  const instanceId = payload?.app?.instance_id;
  if (!instanceId) {
    throw new Error(
      'No default app instance found. Set default in admin UI or provide M9_DIFY_REAL_PROVIDER_INSTANCE_ID.'
    );
  }

  return {
    instanceId,
    source: 'default',
  };
}

function detectAppType(infoPayload) {
  const mode =
    typeof infoPayload?.mode === 'string'
      ? infoPayload.mode.trim().toLowerCase()
      : '';
  if (!mode) {
    return 'unknown';
  }
  if (mode.includes('workflow')) {
    return 'workflow';
  }
  if (mode.includes('completion') || mode.includes('text')) {
    return 'text-generation';
  }
  if (mode.includes('chat')) {
    return 'chatbot';
  }
  return mode;
}

async function main() {
  const suffix = randomSuffix();
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    process.env.M9_DIFY_REAL_DATABASE_URL?.trim() ||
    fallbackDatabaseUrl;
  const redisUrl =
    process.env.REDIS_URL?.trim() ||
    process.env.M9_DIFY_REAL_REDIS_URL?.trim() ||
    fallbackRedisUrl;
  const s3Endpoint =
    process.env.S3_ENDPOINT?.trim() ||
    process.env.M9_DIFY_REAL_S3_ENDPOINT?.trim() ||
    fallbackS3Endpoint;
  const apiEncryptionKey = process.env.API_ENCRYPTION_KEY?.trim() || '';

  if (!apiEncryptionKey) {
    throw new Error(
      'API_ENCRYPTION_KEY is required for real provider verification'
    );
  }

  const appEnv = {
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
    S3_PUBLIC_READ_ENABLED: process.env.S3_PUBLIC_READ_ENABLED || '1',
    API_ENCRYPTION_KEY: apiEncryptionKey,
    FASTIFY_PROXY_ENABLED: useFastifyProxy ? '1' : '0',
    FASTIFY_PROXY_BASE_URL: fastifyBase,
    FASTIFY_PROXY_PREFIXES:
      process.env.FASTIFY_PROXY_PREFIXES ||
      defaultFastifyProxyPrefixes.join(','),
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_DISABLE_SWC_WORKER: process.env.NEXT_DISABLE_SWC_WORKER || '1',
  };

  let appProc = null;
  let apiProc = null;
  let exitCode = 0;
  let executionStatus = null;
  const dbClient = new Client({ connectionString: databaseUrl });

  try {
    let lastStartupError = null;
    for (let attempt = 1; attempt <= appStartRetryCount; attempt += 1) {
      if (useFastifyProxy) {
        apiProc = startProcess('pnpm', ['--filter', '@agentifui/api', 'dev'], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_ENV: 'development',
            DATABASE_URL: databaseUrl,
            REDIS_URL: redisUrl,
            S3_ENDPOINT: s3Endpoint,
            S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || 'minioadmin',
            S3_SECRET_ACCESS_KEY:
              process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
            S3_BUCKET: process.env.S3_BUCKET || 'agentifui',
            S3_ENABLE_PATH_STYLE: process.env.S3_ENABLE_PATH_STYLE || '1',
            S3_PUBLIC_READ_ENABLED: process.env.S3_PUBLIC_READ_ENABLED || '1',
            API_ENCRYPTION_KEY: apiEncryptionKey,
            FASTIFY_API_HOST: '127.0.0.1',
            FASTIFY_API_PORT: String(fastifyPort),
            FASTIFY_LOG_LEVEL: process.env.FASTIFY_LOG_LEVEL || 'error',
            FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS:
              process.env.FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS || '30000',
            NEXT_UPSTREAM_BASE_URL: appBase,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      }

      appProc = startProcess('pnpm', ['next', 'dev', '-p', String(appPort)], {
        cwd: process.cwd(),
        env: appEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      try {
        if (useFastifyProxy) {
          await waitForServer(`${fastifyBase}/healthz`, apiProc, appReadyTimeoutMs);
        }
        await waitForServer(
          `${appBase}/api/auth/better/get-session`,
          appProc,
          appReadyTimeoutMs
        );
        lastStartupError = null;
        break;
      } catch (error) {
        lastStartupError = error;
        await terminateProcess(appProc);
        await terminateProcess(apiProc);
        appProc = null;
        apiProc = null;
        if (attempt < appStartRetryCount) {
          console.warn(
            `[m9-dify-real-provider-verify] app start attempt ${attempt}/${appStartRetryCount} failed, retrying...`
          );
          await sleep(1500);
        }
      }
    }

    if (lastStartupError) {
      throw lastStartupError;
    }

    await dbClient.connect();

    const jar = new CookieJar();
    const email = `m9-real-${suffix}@example.com`;
    const password = `M9REAL!${suffix}`;
    const userId = await signUpAndGetUserId(jar, email, password, `M9 ${suffix}`, appBase);
    await ensureAdminProfile(dbClient, userId, email);

    const target = await resolveTargetInstanceId(jar, appBase);

    const info = await requestWithCookies(
      jar,
      `${appBase}/api/dify/${target.instanceId}/info`,
      {
        method: 'GET',
        headers: {
          origin: appBase,
          referer: `${appBase}/`,
        },
      }
    );
    if (info.headers.get('x-agentifui-next-handler') === 'next-disabled') {
      throw new Error(
        'Next disabled stub responded for /api/dify/* route. Fastify proxy/cutover is not active.'
      );
    }
    assertStatus(info, 200, 'dify info');
    const infoPayload = await info.json().catch(() => null);

    const parameters = await requestWithCookies(
      jar,
      `${appBase}/api/dify/${target.instanceId}/parameters`,
      {
        method: 'GET',
        headers: {
          origin: appBase,
          referer: `${appBase}/`,
        },
      }
    );
    assertStatus(parameters, 200, 'dify parameters');
    const parametersPayload = await parameters.json().catch(() => null);

    const appType = detectAppType(infoPayload);

    if (runExecutionProbe) {
      const executionPath = appType === 'workflow' ? 'run' : 'chat-messages';
      const executionBody =
        executionPath === 'run'
          ? {
              inputs: {},
              response_mode: 'blocking',
              user: `m9-real-${suffix}`,
            }
          : {
              query: 'Health check from M9 real provider verify.',
              inputs: {},
              response_mode: 'blocking',
              user: `m9-real-${suffix}`,
            };

      const execution = await requestJson(
        jar,
        `/api/dify/${target.instanceId}/${executionPath}`,
        'POST',
        executionBody,
        appBase
      );
      executionStatus = execution.response.status;
      if (execution.response.status >= 500) {
        throw new Error(
          `dify execution probe failed with status ${execution.response.status}`
        );
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: {
            sessionReady: true,
            defaultOrConfiguredInstanceResolved: true,
            infoEndpointReachable: true,
            parametersEndpointReachable: true,
            executionProbePass: runExecutionProbe
              ? executionStatus !== null && executionStatus < 500
              : 'skipped',
          },
          artifacts: {
            source: target.source,
            instanceId: target.instanceId,
            appType,
            infoMode:
              typeof infoPayload?.mode === 'string' ? infoPayload.mode : null,
            executionStatus,
            hasParameterSchema: Boolean(parametersPayload),
          },
        },
        null,
        2
      )
    );
  } catch (error) {
    exitCode = 1;
    console.error(
      '[m9-dify-real-provider-verify] failed:',
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    await dbClient.end().catch(() => {});
    await terminateProcess(appProc);
    await terminateProcess(apiProc);
    process.exit(exitCode);
  }
}

main();
