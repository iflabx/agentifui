#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from 'pg';

loadEnv({ path: '.env.test-stack' });

const appPort = Number(process.env.M9_DIFY_PROXY_APP_PORT || 3323);
const appBase = `http://127.0.0.1:${appPort}`;
const useFastifyProxy = process.env.M9_DIFY_PROXY_USE_FASTIFY_PROXY !== '0';
const fastifyPort = Number(process.env.M9_DIFY_PROXY_FASTIFY_PORT || 3423);
const fastifyBase = `http://127.0.0.1:${fastifyPort}`;
const upstreamPort = Number(process.env.M9_DIFY_PROXY_UPSTREAM_PORT || 3523);
const upstreamBase = `http://127.0.0.1:${upstreamPort}`;
const appReadyTimeoutMs = Number(
  process.env.M9_DIFY_PROXY_READY_TIMEOUT_MS || 120000
);
const appStartRetryCount = Math.max(
  1,
  Number(process.env.M9_DIFY_PROXY_APP_START_RETRIES || 2)
);
const upstreamTimeoutDelayMs = Number(
  process.env.M9_DIFY_PROXY_UPSTREAM_TIMEOUT_DELAY_MS || 1200
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

function assertStatusIn(response, expectedStatuses, label) {
  if (expectedStatuses.includes(response.status)) {
    return;
  }

  throw new Error(
    `${label} returned ${response.status}, expected one of ${expectedStatuses.join(', ')}`
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
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        status = 'active',
        updated_at = NOW()
    `,
    [userId, email]
  );
}

async function createDifyFixtures(client, suffix, baseUrl) {
  const providerId = randomUUID();
  const providerName = `m9-dify-provider-${suffix}`;

  const instances = {
    chat: {
      id: randomUUID(),
      instanceId: `m9-chat-${suffix}`,
      appType: 'chatbot',
      isDefault: true,
    },
    workflow: {
      id: randomUUID(),
      instanceId: `m9-workflow-${suffix}`,
      appType: 'workflow',
      isDefault: false,
    },
    text: {
      id: randomUUID(),
      instanceId: `m9-text-${suffix}`,
      appType: 'text-generation',
      isDefault: false,
    },
  };

  const apiKeys = {
    chat: randomUUID(),
    workflow: randomUUID(),
    text: randomUUID(),
  };

  await client.query(
    `
      INSERT INTO providers (
        id,
        name,
        type,
        base_url,
        auth_type,
        is_active,
        is_default,
        created_at,
        updated_at
      ) VALUES (
        $1::uuid,
        $2,
        'dify',
        $3,
        'bearer',
        TRUE,
        FALSE,
        NOW(),
        NOW()
      )
    `,
    [providerId, providerName, baseUrl]
  );

  for (const item of Object.values(instances)) {
    await client.query(
      `
        INSERT INTO service_instances (
          id,
          provider_id,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility,
          config,
          created_at,
          updated_at
        ) VALUES (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7,
          'public',
          $8::jsonb,
          NOW(),
          NOW()
        )
      `,
      [
        item.id,
        providerId,
        `${item.instanceId}-display`,
        `${item.instanceId}-description`,
        item.instanceId,
        `/api/${item.instanceId}`,
        item.isDefault,
        JSON.stringify({ app_metadata: { dify_apptype: item.appType } }),
      ]
    );
  }

  await client.query(
    `
      INSERT INTO api_keys (
        id,
        provider_id,
        service_instance_id,
        user_id,
        key_value,
        is_default,
        usage_count
      ) VALUES
        ($1::uuid, $4::uuid, $7::uuid, NULL, $10, TRUE, 0),
        ($2::uuid, $5::uuid, $8::uuid, NULL, $11, TRUE, 0),
        ($3::uuid, $6::uuid, $9::uuid, NULL, $12, TRUE, 0)
    `,
    [
      apiKeys.chat,
      apiKeys.workflow,
      apiKeys.text,
      providerId,
      providerId,
      providerId,
      instances.chat.id,
      instances.workflow.id,
      instances.text.id,
      `m9-chat-key-${suffix}`,
      `m9-workflow-key-${suffix}`,
      `m9-text-key-${suffix}`,
    ]
  );

  return {
    providerId,
    instances,
    apiKeys,
  };
}

async function cleanupDifyFixtures(client, fixtures) {
  await client.query(
    `DELETE FROM api_keys WHERE id = ANY($1::uuid[])`,
    [[fixtures.apiKeys.chat, fixtures.apiKeys.workflow, fixtures.apiKeys.text]]
  );
  await client.query(
    `DELETE FROM service_instances WHERE id = ANY($1::uuid[])`,
    [[
      fixtures.instances.chat.id,
      fixtures.instances.workflow.id,
      fixtures.instances.text.id,
    ]]
  );
  await client.query(`DELETE FROM providers WHERE id = $1::uuid`, [
    fixtures.providerId,
  ]);
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function startMockDifyServer(port) {
  const calls = [];

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
    const path = url.pathname;
    const method = (request.method || 'GET').toUpperCase();
    const requestBody = await readRequestBody(request).catch(() => '');

    calls.push({ method, path, query: url.search, requestBody });

    if (path === '/timeout') {
      setTimeout(() => {
        response.writeHead(200, {
          'content-type': 'application/json',
        });
        response.end(
          JSON.stringify({ success: true, mode: 'timeout', delayed: true })
        );
      }, upstreamTimeoutDelayMs);
      return;
    }

    if (path === '/error') {
      response.writeHead(500, {
        'content-type': 'application/json',
      });
      response.end(
        JSON.stringify({
          code: 'provider_quota_exceeded',
          message: 'provider_quota_exceeded',
        })
      );
      return;
    }

    if (
      path === '/chat-messages' ||
      path === '/completion-messages' ||
      path === '/workflows/run'
    ) {
      response.writeHead(200, {
        'content-type': 'application/json',
      });
      response.end(
        JSON.stringify({
          success: true,
          path,
          method,
          query: url.search,
        })
      );
      return;
    }

    response.writeHead(404, {
      'content-type': 'application/json',
    });
    response.end(
      JSON.stringify({
        success: false,
        path,
        message: 'not found',
      })
    );
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, calls });
    });
  });
}

function stopMockDifyServer(server) {
  if (!server) {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    server.close(() => resolve());
  });
}

async function main() {
  const suffix = randomSuffix();
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    process.env.M9_DIFY_PROXY_DATABASE_URL?.trim() ||
    fallbackDatabaseUrl;
  const redisUrl =
    process.env.REDIS_URL?.trim() ||
    process.env.M9_DIFY_PROXY_REDIS_URL?.trim() ||
    fallbackRedisUrl;
  const s3Endpoint =
    process.env.S3_ENDPOINT?.trim() ||
    process.env.M9_DIFY_PROXY_S3_ENDPOINT?.trim() ||
    fallbackS3Endpoint;

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
    API_ENCRYPTION_KEY:
      process.env.API_ENCRYPTION_KEY ||
      randomBytes(32).toString('hex').slice(0, 32),
    FASTIFY_PROXY_ENABLED: useFastifyProxy ? '1' : '0',
    FASTIFY_PROXY_BASE_URL: fastifyBase,
    FASTIFY_PROXY_PREFIXES:
      process.env.FASTIFY_PROXY_PREFIXES ||
      defaultFastifyProxyPrefixes.join(','),
    DIFY_PROXY_TIMEOUT_MS: process.env.DIFY_PROXY_TIMEOUT_MS || '1000',
    DIFY_PROXY_CIRCUIT_ENABLED:
      process.env.DIFY_PROXY_CIRCUIT_ENABLED || '1',
    DIFY_PROXY_CIRCUIT_FAILURE_THRESHOLD:
      process.env.DIFY_PROXY_CIRCUIT_FAILURE_THRESHOLD || '2',
    DIFY_PROXY_CIRCUIT_FAILURE_WINDOW_MS:
      process.env.DIFY_PROXY_CIRCUIT_FAILURE_WINDOW_MS || '60000',
    DIFY_PROXY_CIRCUIT_OPEN_DURATION_MS:
      process.env.DIFY_PROXY_CIRCUIT_OPEN_DURATION_MS || '5000',
    DIFY_PROXY_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT:
      process.env.DIFY_PROXY_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT || '1',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_DISABLE_SWC_WORKER: process.env.NEXT_DISABLE_SWC_WORKER || '1',
  };

  let appProc = null;
  let apiProc = null;
  let mockServer = null;
  let mockCalls = [];
  let fixtures = null;
  let exitCode = 0;

  const dbClient = new Client({ connectionString: databaseUrl });

  try {
    const mock = await startMockDifyServer(upstreamPort);
    mockServer = mock.server;
    mockCalls = mock.calls;

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
            API_ENCRYPTION_KEY: appEnv.API_ENCRYPTION_KEY,
            FASTIFY_API_HOST: '127.0.0.1',
            FASTIFY_API_PORT: String(fastifyPort),
            FASTIFY_LOG_LEVEL: process.env.FASTIFY_LOG_LEVEL || 'error',
            FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS:
              process.env.FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS || '30000',
            NEXT_UPSTREAM_BASE_URL: appBase,
            DIFY_PROXY_TIMEOUT_MS: appEnv.DIFY_PROXY_TIMEOUT_MS,
            DIFY_PROXY_CIRCUIT_ENABLED: appEnv.DIFY_PROXY_CIRCUIT_ENABLED,
            DIFY_PROXY_CIRCUIT_FAILURE_THRESHOLD:
              appEnv.DIFY_PROXY_CIRCUIT_FAILURE_THRESHOLD,
            DIFY_PROXY_CIRCUIT_FAILURE_WINDOW_MS:
              appEnv.DIFY_PROXY_CIRCUIT_FAILURE_WINDOW_MS,
            DIFY_PROXY_CIRCUIT_OPEN_DURATION_MS:
              appEnv.DIFY_PROXY_CIRCUIT_OPEN_DURATION_MS,
            DIFY_PROXY_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT:
              appEnv.DIFY_PROXY_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT,
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
            `[m9-dify-proxy-verify] app start attempt ${attempt}/${appStartRetryCount} failed, retrying...`
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
    const email = `m9-dify-${suffix}@example.com`;
    const password = `M9DIFY!${suffix}`;
    const userId = await signUpAndGetUserId(jar, email, password, `M9 ${suffix}`);
    await ensureProfileRow(dbClient, userId, email);

    fixtures = await createDifyFixtures(dbClient, suffix, upstreamBase);

    const chatRequest = await requestJson(
      jar,
      `/api/dify/${fixtures.instances.chat.instanceId}/chat-messages`,
      'POST',
      {
        query: 'hello',
        inputs: {},
      }
    );
    assertStatus(chatRequest.response, 200, 'chat app proxy');
    if (chatRequest.payload?.path !== '/chat-messages') {
      throw new Error('chat app path rewrite mismatch');
    }

    const workflowRequest = await requestJson(
      jar,
      `/api/dify/${fixtures.instances.workflow.instanceId}/run`,
      'POST',
      {
        inputs: {},
      }
    );
    assertStatus(workflowRequest.response, 200, 'workflow app proxy');
    if (workflowRequest.payload?.path !== '/workflows/run') {
      throw new Error('workflow app path rewrite mismatch');
    }

    const textRequest = await requestJson(
      jar,
      `/api/dify/${fixtures.instances.text.instanceId}/chat-messages`,
      'POST',
      {
        query: 'hello',
        inputs: {},
      }
    );
    assertStatus(textRequest.response, 200, 'text-generation app proxy');
    if (textRequest.payload?.path !== '/completion-messages') {
      throw new Error('text-generation path rewrite mismatch');
    }

    const upstreamError = await requestJson(
      jar,
      `/api/dify/${fixtures.instances.chat.instanceId}/error`,
      'POST',
      {
        query: 'error',
      }
    );
    assertStatus(upstreamError.response, 500, 'upstream error mapping');
    if (!upstreamError.payload?.agent_error?.code) {
      throw new Error('upstream error missing agent_error envelope');
    }

    const timeoutA = await requestJson(
      jar,
      `/api/dify/${fixtures.instances.chat.instanceId}/timeout`,
      'POST',
      {
        query: 'timeout-a',
      }
    );
    assertStatus(timeoutA.response, 504, 'upstream timeout #1');

    const timeoutB = await requestJson(
      jar,
      `/api/dify/${fixtures.instances.chat.instanceId}/timeout`,
      'POST',
      {
        query: 'timeout-b',
      }
    );
    assertStatusIn(timeoutB.response, [503, 504], 'upstream timeout #2');

    const circuitOpen = await requestJson(
      jar,
      `/api/dify/${fixtures.instances.chat.instanceId}/chat-messages`,
      'POST',
      {
        query: 'after-circuit-open',
      }
    );
    assertStatus(circuitOpen.response, 503, 'circuit open rejection');
    if (!circuitOpen.payload?.app_error?.code) {
      throw new Error('circuit open response missing app_error envelope');
    }

    const opsUnauthorized = await requestWithCookies(
      jar,
      `${appBase}/api/internal/ops/dify-resilience`,
      {
        method: 'GET',
      }
    );
    assertStatus(opsUnauthorized, 403, 'dify resilience ops admin guard');

    const importantCalls = mockCalls.filter(call =>
      ['/chat-messages', '/completion-messages', '/workflows/run'].includes(
        call.path
      )
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: {
            chatPathRewrite: true,
            workflowPathRewrite: true,
            textGenerationPathRewrite: true,
            upstreamErrorEnvelope: true,
            timeoutHandling: true,
            circuitOpenHandling: true,
            resilienceOpsAdminGuard: true,
          },
          metrics: {
            upstreamCallCount: mockCalls.length,
            importantCallCount: importantCalls.length,
            timeoutCalls: mockCalls.filter(call => call.path === '/timeout').length,
          },
        },
        null,
        2
      )
    );
  } catch (error) {
    exitCode = 1;
    console.error(
      '[m9-dify-proxy-verify] failed:',
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    if (fixtures) {
      await cleanupDifyFixtures(dbClient, fixtures).catch(() => {});
    }
    await dbClient.end().catch(() => {});
    await terminateProcess(appProc);
    await terminateProcess(apiProc);
    await stopMockDifyServer(mockServer).catch(() => {});
    process.exit(exitCode);
  }
}

main();
