#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from 'pg';

loadEnv({ path: '.env.test-stack' });

const appPort = Number(process.env.M6_REALTIME_APP_PORT || 3321);
const appBase = `http://127.0.0.1:${appPort}`;
const appReadyTimeoutMs = Number(
  process.env.M6_REALTIME_READY_TIMEOUT_MS || 120000
);
const appStartRetryCount = Math.max(
  1,
  Number(process.env.M6_REALTIME_APP_START_RETRIES || 2)
);
const eventTimeoutMs = Number(process.env.M6_REALTIME_EVENT_TIMEOUT_MS || 12000);
const m6MigrationFileUrl = new URL(
  '../supabase/migrations/20260215170000_m6_realtime_outbox_cdc.sql',
  import.meta.url
);

const fallbackDatabaseUrl =
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui';
const fallbackRedisUrl = 'redis://172.20.0.1:6379/0';
const fallbackS3Endpoint = 'http://172.20.0.1:9000';

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

async function applyM6RealtimeMigration(connectionString) {
  const sql = readFileSync(m6MigrationFileUrl, 'utf8');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end().catch(() => {});
  }
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
    let eventId = null;
    const dataParts = [];

    for (const line of lines) {
      if (line.startsWith('id:')) {
        const parsedId = line.slice('id:'.length).trim();
        eventId = parsedId || null;
        continue;
      }

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
      id: eventId,
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
      ON CONFLICT (id) DO NOTHING
    `,
    [userId, email]
  );
}

async function promoteProfileToAdmin(client, userId) {
  await client.query(
    `
      UPDATE profiles
      SET role = 'admin',
          status = 'active',
          updated_at = NOW()
      WHERE id = $1::uuid
    `,
    [userId]
  );
}

async function createServiceInstanceFixture(client, suffix) {
  const providerId = randomUUID();
  const serviceInstanceId = randomUUID();

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
        $3,
        $4,
        $5,
        TRUE,
        FALSE,
        NOW(),
        NOW()
      )
    `,
    [
      providerId,
      `m6-provider-${suffix}`,
      'm6-provider',
      `https://m6-provider-${suffix}.example.test`,
      'none',
    ]
  );

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
        FALSE,
        'public',
        '{}'::jsonb,
        NOW(),
        NOW()
      )
    `,
    [
      serviceInstanceId,
      providerId,
      `M6 Service Instance ${suffix}`,
      'm6 realtime test service instance',
      `m6-instance-${suffix}`,
      `/m6-instance-${suffix}`,
    ]
  );

  return {
    providerId,
    serviceInstanceId,
  };
}

async function createConversationFixture(client, userId, suffix) {
  const conversationId = randomUUID();
  await client.query(
    `
      INSERT INTO conversations (
        id,
        user_id,
        title,
        summary,
        ai_config_id,
        app_id,
        external_id,
        settings,
        status,
        last_message_preview,
        created_at,
        updated_at
      ) VALUES (
        $1::uuid,
        $2::uuid,
        $3,
        NULL,
        NULL,
        NULL,
        NULL,
        '{}'::jsonb,
        'active',
        NULL,
        NOW(),
        NOW()
      )
    `,
    [conversationId, userId, `M6 Conversation ${suffix}`]
  );
  return conversationId;
}

async function openRealtimeStream(jar, key, config, options = {}) {
  const params = new URLSearchParams({
    key,
    schema: config.schema,
    table: config.table,
    event: config.event,
  });
  if (config.filter) {
    params.set('filter', config.filter);
  }
  if (options.lastEventId) {
    params.set('lastEventId', options.lastEventId);
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
        ...(options.lastEventId
          ? { 'last-event-id': String(options.lastEventId) }
          : {}),
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
  const migratorDatabaseUrl =
    process.env.MIGRATOR_DATABASE_URL?.trim() ||
    process.env.M6_REALTIME_MIGRATOR_DATABASE_URL?.trim() ||
    databaseUrl;
  const redisUrl =
    process.env.REDIS_URL?.trim() ||
    process.env.M6_REALTIME_REDIS_URL?.trim() ||
    fallbackRedisUrl;
  const s3Endpoint =
    process.env.S3_ENDPOINT?.trim() ||
    process.env.M6_REALTIME_S3_ENDPOINT?.trim() ||
    fallbackS3Endpoint;
  const shouldApplyMigration = parseBooleanEnv(
    process.env.M6_REALTIME_APPLY_MIGRATION,
    true
  );

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
    REALTIME_SSE_KEEPALIVE_MS: process.env.REALTIME_SSE_KEEPALIVE_MS || '3000',
    REALTIME_SOURCE_MODE: process.env.REALTIME_SOURCE_MODE || 'db-outbox',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_DISABLE_SWC_WORKER: process.env.NEXT_DISABLE_SWC_WORKER || '1',
  };

  let appProc = null;

  const dbClient = new Client({ connectionString: databaseUrl });
  const collectors = [];
  let exitCode = 0;

  try {
    if (shouldApplyMigration) {
      await applyM6RealtimeMigration(migratorDatabaseUrl);
    }

    let lastStartupError = null;
    for (let attempt = 1; attempt <= appStartRetryCount; attempt += 1) {
      appProc = startProcess('pnpm', ['next', 'dev', '-p', String(appPort)], {
        cwd: process.cwd(),
        env: appEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      try {
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
        appProc = null;
        if (attempt < appStartRetryCount) {
          console.warn(
            `[m6-realtime-e2e] app start attempt ${attempt}/${appStartRetryCount} failed, retrying...`
          );
          await sleep(1500);
        }
      }
    }

    if (lastStartupError) {
      throw lastStartupError;
    }

    await waitForServer(
      `${appBase}/api/auth/better/get-session`,
      appProc,
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
    await promoteProfileToAdmin(dbClient, userAId);
    const { serviceInstanceId } = await createServiceInstanceFixture(
      dbClient,
      suffix
    );
    const conversationId = await createConversationFixture(dbClient, userAId, suffix);

    const userAProfileKey = `user-profile:${userAId}`;
    const userAStream = await openRealtimeStream(jarA, userAProfileKey, {
      schema: 'public',
      table: 'profiles',
      event: 'UPDATE',
      filter: `id=eq.${userAId}`,
    });
    assertStatus(userAStream, 200, 'realtime stream owner');

    const profileCollector = new SseCollector(userAStream);
    collectors.push(profileCollector);
    await profileCollector.waitFor(
      event => event.event === 'ready',
      eventTimeoutMs,
      'stream ready'
    );

    const updatedName = `M6-E2E-1-${suffix}`;
    const patchProfile = await requestJson(jarA, '/api/internal/profile', 'PATCH', {
      updates: {
        full_name: updatedName,
      },
    });
    assertStatus(patchProfile.response, 200, 'profile patch owner');

    const profileUpdateEvent = await profileCollector.waitFor(
      event =>
        event.event === 'message' &&
        event.data?.key === userAProfileKey &&
        event.data?.payload?.table === 'profiles' &&
        event.data?.payload?.eventType === 'UPDATE' &&
        event.data?.payload?.new?.full_name === updatedName,
      eventTimeoutMs,
      'profile update event'
    );

    const externalName = `M6-EXT-${suffix}`;
    await dbClient.query(
      `
        UPDATE profiles
        SET full_name = $2,
            updated_at = NOW()
        WHERE id = $1::uuid
      `,
      [userAId, externalName]
    );

    const externalUpdateEvent = await profileCollector.waitFor(
      event =>
        event.event === 'message' &&
        event.data?.key === userAProfileKey &&
        event.data?.payload?.table === 'profiles' &&
        event.data?.payload?.eventType === 'UPDATE' &&
        event.data?.payload?.new?.full_name === externalName,
      eventTimeoutMs,
      'profile external write event'
    );

    const firstProfileEventId =
      externalUpdateEvent?.id || externalUpdateEvent?.data?.id || '';
    if (!firstProfileEventId) {
      throw new Error('profile update event id is missing');
    }

    await profileCollector.close();
    const profileCollectorIndex = collectors.indexOf(profileCollector);
    if (profileCollectorIndex >= 0) {
      collectors.splice(profileCollectorIndex, 1);
    }

    const replayName = `M6-E2E-2-${suffix}`;
    const patchProfileReplay = await requestJson(
      jarA,
      '/api/internal/profile',
      'PATCH',
      {
        updates: {
          full_name: replayName,
        },
      }
    );
    assertStatus(patchProfileReplay.response, 200, 'profile patch for replay');

    const replayStream = await openRealtimeStream(
      jarA,
      userAProfileKey,
      {
        schema: 'public',
        table: 'profiles',
        event: 'UPDATE',
        filter: `id=eq.${userAId}`,
      },
      {
        lastEventId: firstProfileEventId,
      }
    );
    assertStatus(replayStream, 200, 'realtime stream replay owner');

    const replayCollector = new SseCollector(replayStream);
    collectors.push(replayCollector);
    await replayCollector.waitFor(
      event => event.event === 'ready',
      eventTimeoutMs,
      'replay stream ready'
    );
    const replayEvent = await replayCollector.waitFor(
      event =>
        event.event === 'message' &&
        event.data?.key === userAProfileKey &&
        event.data?.payload?.table === 'profiles' &&
        event.data?.payload?.eventType === 'UPDATE' &&
        event.data?.payload?.new?.full_name === replayName,
      eventTimeoutMs,
      'profile replay event'
    );

    const crossUserStream = await openRealtimeStream(jarB, userAProfileKey, {
      schema: 'public',
      table: 'profiles',
      event: 'UPDATE',
      filter: `id=eq.${userAId}`,
    });
    assertStatus(crossUserStream, 403, 'realtime stream cross-user forbidden');

    const nonAdminApiKeysStream = await openRealtimeStream(jarB, 'api-keys', {
      schema: 'public',
      table: 'api_keys',
      event: '*',
    });
    assertStatus(
      nonAdminApiKeysStream,
      403,
      'realtime stream api-keys admin-only'
    );

    const serviceInstancesKey = 'service-instances';
    const serviceInstancesStream = await openRealtimeStream(
      jarA,
      serviceInstancesKey,
      {
        schema: 'public',
        table: 'service_instances',
        event: 'UPDATE',
      }
    );
    assertStatus(serviceInstancesStream, 200, 'service-instances stream admin');

    const serviceCollector = new SseCollector(serviceInstancesStream);
    collectors.push(serviceCollector);
    await serviceCollector.waitFor(
      event => event.event === 'ready',
      eventTimeoutMs,
      'service-instances stream ready'
    );

    const patchServiceInstance = await requestJson(jarA, '/api/internal/apps', 'PATCH', {
      id: serviceInstanceId,
      visibility: 'private',
    });
    assertStatus(patchServiceInstance.response, 200, 'service-instances patch admin');

    const serviceUpdateEvent = await serviceCollector.waitFor(
      event =>
        event.event === 'message' &&
        event.data?.key === serviceInstancesKey &&
        event.data?.payload?.table === 'service_instances' &&
        event.data?.payload?.eventType === 'UPDATE' &&
        event.data?.payload?.new?.id === serviceInstanceId &&
        event.data?.payload?.new?.visibility === 'private',
      eventTimeoutMs,
      'service-instances update event'
    );

    const conversationMessagesKey = `conversation-messages:${conversationId}`;
    const ownerConversationStream = await openRealtimeStream(
      jarA,
      conversationMessagesKey,
      {
        schema: 'public',
        table: 'messages',
        event: '*',
        filter: `conversation_id=eq.${conversationId}`,
      }
    );
    assertStatus(
      ownerConversationStream,
      200,
      'conversation-messages stream owner'
    );
    const conversationCollector = new SseCollector(ownerConversationStream);
    collectors.push(conversationCollector);
    await conversationCollector.waitFor(
      event => event.event === 'ready',
      eventTimeoutMs,
      'conversation-messages stream ready'
    );

    const messageId = randomUUID();
    await dbClient.query(
      `
        INSERT INTO messages (
          id,
          conversation_id,
          user_id,
          role,
          content,
          metadata,
          status,
          is_synced,
          sequence_index,
          created_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          'user',
          $4,
          $5::jsonb,
          'sent',
          TRUE,
          0,
          NOW()
        )
      `,
      [
        messageId,
        conversationId,
        userAId,
        `M6 conversation event ${suffix}`,
        JSON.stringify({ source: 'm6-realtime-e2e' }),
      ]
    );

    const messageInsertEvent = await conversationCollector.waitFor(
      event =>
        event.event === 'message' &&
        event.data?.key === conversationMessagesKey &&
        event.data?.payload?.table === 'messages' &&
        event.data?.payload?.eventType === 'INSERT' &&
        event.data?.payload?.new?.id === messageId,
      eventTimeoutMs,
      'conversation-messages insert delivery'
    );

    const crossConversationStream = await openRealtimeStream(
      jarB,
      conversationMessagesKey,
      {
        schema: 'public',
        table: 'messages',
        event: '*',
        filter: `conversation_id=eq.${conversationId}`,
      }
    );
    assertStatus(
      crossConversationStream,
      403,
      'conversation-messages stream cross-user forbidden'
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: {
            ownerProfileStreamConnected: true,
            profileUpdateDelivered: true,
            externalWriteDelivered: true,
            profileReplayDelivered: true,
            serviceInstancesUpdateDelivered: true,
            ownerConversationStreamConnected: true,
            conversationMessageDelivered: true,
            conversationCrossUserForbidden: true,
            crossUserProfileForbidden: true,
            apiKeysStreamAdminOnly: true,
          },
          artifacts: {
            userAId,
            userBId,
            key: userAProfileKey,
            serviceInstanceId,
            conversationId,
            profileEventId: firstProfileEventId,
            profileApiUpdateEventId:
              profileUpdateEvent?.id || profileUpdateEvent?.data?.id || null,
            profileReplayEventId: replayEvent?.id || replayEvent?.data?.id || null,
            serviceUpdateEventId:
              serviceUpdateEvent?.id || serviceUpdateEvent?.data?.id || null,
            messageInsertEventId:
              messageInsertEvent?.id || messageInsertEvent?.data?.id || null,
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
    while (collectors.length > 0) {
      const collector = collectors.pop();
      if (collector) {
        await collector.close().catch(() => {});
      }
    }
    await dbClient.end().catch(() => {});
    await terminateProcess(appProc);
    process.exit(exitCode);
  }
}

main();
