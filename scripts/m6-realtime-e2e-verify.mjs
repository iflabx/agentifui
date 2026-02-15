#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from 'pg';

loadEnv({ path: '.env.test-stack' });

const appPort = Number(process.env.M6_REALTIME_APP_PORT || 3321);
const appBase = `http://127.0.0.1:${appPort}`;
const appReadyTimeoutMs = Number(
  process.env.M6_REALTIME_READY_TIMEOUT_MS || 120000
);
const eventTimeoutMs = Number(process.env.M6_REALTIME_EVENT_TIMEOUT_MS || 12000);

const fallbackDatabaseUrl =
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui';
const fallbackRedisUrl = 'redis://172.20.0.1:6379/0';
const fallbackS3Endpoint = 'http://172.20.0.1:9000';

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

class SseCollector {
  constructor(response) {
    this.reader = response.body?.getReader();
    this.decoder = new TextDecoder();
    this.buffer = '';
    this.waiters = [];
    this.events = [];
    this.maxBufferedEvents = 2048;
    this.closed = false;
    this.loopPromise = Promise.resolve();

    if (!this.reader) {
      throw new Error('SSE response body is not readable');
    }

    this.loopPromise = this.readLoop();
  }

  async readLoop() {
    try {
      while (!this.closed) {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }

        this.buffer += this.decoder.decode(value, { stream: true });
        this.drainEvents();
      }
    } catch (error) {
      if (!this.closed) {
        console.warn(
          '[m6-realtime-e2e] SSE read loop interrupted:',
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  drainEvents() {
    let delimiterIndex = this.buffer.indexOf('\n\n');
    while (delimiterIndex !== -1) {
      const rawEvent = this.buffer.slice(0, delimiterIndex);
      this.buffer = this.buffer.slice(delimiterIndex + 2);
      this.handleRawEvent(rawEvent);
      delimiterIndex = this.buffer.indexOf('\n\n');
    }
  }

  handleRawEvent(rawEvent) {
    const lines = rawEvent
      .split('\n')
      .map(line => line.replace(/\r$/, ''))
      .filter(Boolean);

    if (lines.length === 0) {
      return;
    }

    let eventType = 'message';
    const dataParts = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice('event:'.length).trim() || 'message';
        continue;
      }

      if (line.startsWith('data:')) {
        dataParts.push(line.slice('data:'.length).trim());
      }
    }

    if (dataParts.length === 0) {
      return;
    }

    const rawData = dataParts.join('\n');
    let parsedData = rawData;
    try {
      parsedData = JSON.parse(rawData);
    } catch {
      // keep raw text
    }

    const event = {
      event: eventType,
      data: parsedData,
      receivedAt: Date.now(),
    };

    let matchedAnyWaiter = false;
    const pending = [...this.waiters];
    for (const waiter of pending) {
      if (!waiter.predicate(event)) {
        continue;
      }

      matchedAnyWaiter = true;
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter(item => item !== waiter);
      waiter.resolve(event);
    }

    if (!matchedAnyWaiter) {
      this.events.push(event);
      if (this.events.length > this.maxBufferedEvents) {
        this.events.shift();
      }
    }
  }

  consumeBufferedEvent(predicate) {
    for (let i = 0; i < this.events.length; i += 1) {
      const event = this.events[i];
      if (!predicate(event)) {
        continue;
      }

      this.events.splice(i, 1);
      return event;
    }

    return null;
  }

  waitFor(predicate, timeoutMs, label) {
    const buffered = this.consumeBufferedEvent(predicate);
    if (buffered) {
      return Promise.resolve(buffered);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(item => item !== waiter);
        reject(new Error(`SSE wait timeout: ${label}`));
      }, timeoutMs);

      const waiter = { predicate, resolve, reject, timer };
      this.waiters.push(waiter);
    });
  }

  async close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    const pending = [...this.waiters];
    this.waiters = [];
    for (const waiter of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('SSE collector closed'));
    }

    try {
      await this.reader.cancel();
    } catch {
      // ignore
    }
    await this.loopPromise.catch(() => {});
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

async function openRealtimeStream(jar, key, config) {
  const params = new URLSearchParams({
    key,
    schema: config.schema,
    table: config.table,
    event: config.event,
  });
  if (config.filter) {
    params.set('filter', config.filter);
  }

  const response = await requestWithCookies(
    jar,
    `${appBase}/api/internal/realtime/stream?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        origin: appBase,
        referer: `${appBase}/`,
      },
    }
  );

  return response;
}

async function main() {
  const suffix = randomSuffix();
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    process.env.M6_REALTIME_DATABASE_URL?.trim() ||
    fallbackDatabaseUrl;
  const redisUrl =
    process.env.REDIS_URL?.trim() ||
    process.env.M6_REALTIME_REDIS_URL?.trim() ||
    fallbackRedisUrl;
  const s3Endpoint =
    process.env.S3_ENDPOINT?.trim() ||
    process.env.M6_REALTIME_S3_ENDPOINT?.trim() ||
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
      S3_PUBLIC_READ_ENABLED: process.env.S3_PUBLIC_READ_ENABLED || '1',
      REALTIME_SSE_KEEPALIVE_MS: process.env.REALTIME_SSE_KEEPALIVE_MS || '3000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stopApp = async () => {
    if (!appProc.killed && appProc.exitCode === null) {
      appProc.kill('SIGTERM');
      await sleep(800);
      if (appProc.exitCode === null) {
        appProc.kill('SIGKILL');
      }
    }
  };

  const dbClient = new Client({ connectionString: databaseUrl });
  let collector = null;
  let exitCode = 0;

  try {
    await waitForServer(
      `${appBase}/api/auth/better/get-session`,
      appReadyTimeoutMs
    );

    const jarA = new CookieJar();
    const jarB = new CookieJar();
    const userAEmail = `m6-a-${suffix}@example.com`;
    const userBEmail = `m6-b-${suffix}@example.com`;
    const userAPassword = `M6A!${suffix}`;
    const userBPassword = `M6B!${suffix}`;

    const userAId = await signUpAndGetUserId(
      jarA,
      userAEmail,
      userAPassword,
      `M6 User A ${suffix}`
    );
    const userBId = await signUpAndGetUserId(
      jarB,
      userBEmail,
      userBPassword,
      `M6 User B ${suffix}`
    );

    await dbClient.connect();
    await ensureProfileRow(dbClient, userAId, userAEmail);
    await ensureProfileRow(dbClient, userBId, userBEmail);

    const userAProfileKey = `user-profile:${userAId}`;
    const userAStream = await openRealtimeStream(jarA, userAProfileKey, {
      schema: 'public',
      table: 'profiles',
      event: 'UPDATE',
      filter: `id=eq.${userAId}`,
    });
    assertStatus(userAStream, 200, 'realtime stream owner');

    collector = new SseCollector(userAStream);
    await collector.waitFor(
      event => event.event === 'ready',
      eventTimeoutMs,
      'stream ready'
    );

    const updatedName = `M6-E2E-${suffix}`;
    const patchProfile = await requestJson(jarA, '/api/internal/profile', 'PATCH', {
      updates: {
        full_name: updatedName,
      },
    });
    assertStatus(patchProfile.response, 200, 'profile patch owner');

    const profileUpdateEvent = await collector.waitFor(
      event =>
        event.event === 'message' &&
        event.data?.key === userAProfileKey &&
        event.data?.payload?.table === 'profiles' &&
        event.data?.payload?.eventType === 'UPDATE' &&
        event.data?.payload?.new?.full_name === updatedName,
      eventTimeoutMs,
      'profile update event'
    );

    const crossUserStream = await openRealtimeStream(jarB, userAProfileKey, {
      schema: 'public',
      table: 'profiles',
      event: 'UPDATE',
      filter: `id=eq.${userAId}`,
    });
    assertStatus(crossUserStream, 403, 'realtime stream cross-user forbidden');

    const nonAdminApiKeysStream = await openRealtimeStream(jarA, 'api-keys', {
      schema: 'public',
      table: 'api_keys',
      event: '*',
    });
    assertStatus(
      nonAdminApiKeysStream,
      403,
      'realtime stream api-keys admin-only'
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: {
            ownerProfileStreamConnected: true,
            profileUpdateDelivered: true,
            crossUserProfileForbidden: true,
            apiKeysStreamAdminOnly: true,
          },
          artifacts: {
            userAId,
            key: userAProfileKey,
            receivedEvent: profileUpdateEvent?.data || null,
          },
        },
        null,
        2
      )
    );

    exitCode = 0;
  } catch (error) {
    console.error(
      '[m6-realtime-e2e] failed:',
      error instanceof Error ? error.message : String(error)
    );
    exitCode = 1;
  } finally {
    if (collector) {
      await collector.close().catch(() => {});
    }
    await dbClient.end().catch(() => {});
    await stopApp();
    process.exit(exitCode);
  }
}

main();
