#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

loadEnv({ path: '.env.test-stack' });

const appPort = Number(process.env.M3_INTERNAL_DATA_APP_PORT || 3316);
const appBase = `http://127.0.0.1:${appPort}`;
const useFastifyProxy = process.env.M3_INTERNAL_DATA_USE_FASTIFY_PROXY !== '0';
const fastifyPort = Number(process.env.M3_INTERNAL_DATA_FASTIFY_PORT || 3317);
const fastifyBase = `http://127.0.0.1:${fastifyPort}`;
const appReadyTimeoutMs = Number(
  process.env.M3_INTERNAL_DATA_READY_TIMEOUT_MS || 120000
);
const fallbackDatabaseUrl =
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui';
const fallbackRedisUrl = 'redis://172.20.0.1:6379/0';
const fallbackS3Endpoint = 'http://172.20.0.1:9000';

function randomSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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
      const maxAge = maxAgeAttr
        ? Number(maxAgeAttr.split('=')[1])
        : Number.NaN;
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

async function stopProcess(proc) {
  if (!proc) {
    return;
  }
  if (!proc.killed && proc.exitCode === null) {
    proc.kill('SIGTERM');
    await sleep(800);
    if (proc.exitCode === null) {
      proc.kill('SIGKILL');
    }
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

function assertStatus(response, expectedStatus, label) {
  if (response.status === expectedStatus) {
    return;
  }

  throw new Error(`${label} returned ${response.status}, expected ${expectedStatus}`);
}

function assertInternalDataHandler(response, expected, label, enabled) {
  if (!enabled) {
    return;
  }

  const actual = response.headers.get('x-agentifui-internal-data-handler');
  if (actual === expected) {
    return;
  }

  throw new Error(
    `${label} handler=${actual || '<missing>'}, expected ${expected}`
  );
}

async function signUpAndGetUserId(jar, email, password, name) {
  const signUp = await requestJson(jar, '/api/auth/better/sign-up/email', 'POST', {
    email,
    password,
    name,
    callbackURL: '/chat/new',
  });
  assertStatus(signUp.response, 200, 'sign-up/email');

  const session = await requestWithCookies(jar, `${appBase}/api/auth/better/get-session`, {
    method: 'GET',
  });
  assertStatus(session, 200, 'get-session');
  const payload = await session.json().catch(() => null);
  const userId = payload?.user?.id;
  if (!userId) {
    throw new Error(`session user id missing for ${email}`);
  }

  return userId;
}

async function callInternalAction(jar, action, payload) {
  const response = await requestWithCookies(jar, `${appBase}/api/internal/data`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: appBase,
      referer: `${appBase}/`,
    },
    body: JSON.stringify({ action, payload }),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function main() {
  const suffix = randomSuffix();
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    process.env.M3_INTERNAL_DATA_DATABASE_URL?.trim() ||
    fallbackDatabaseUrl;
  const redisUrl =
    process.env.REDIS_URL?.trim() ||
    process.env.M3_INTERNAL_DATA_REDIS_URL?.trim() ||
    fallbackRedisUrl;
  const s3Endpoint =
    process.env.S3_ENDPOINT?.trim() ||
    process.env.M3_INTERNAL_DATA_S3_ENDPOINT?.trim() ||
    fallbackS3Endpoint;

  const appProc = startProcess('pnpm', ['next', 'dev', '-p', String(appPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NEXT_PUBLIC_APP_URL: appBase,
      BETTER_AUTH_URL: appBase,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ||
        'm3-internal-data-e2e-secret-not-for-production',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      S3_ENDPOINT: s3Endpoint,
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || 'minioadmin',
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
      S3_BUCKET: process.env.S3_BUCKET || 'agentifui',
      S3_ENABLE_PATH_STYLE: process.env.S3_ENABLE_PATH_STYLE || '1',
      FASTIFY_PROXY_ENABLED: useFastifyProxy ? '1' : '0',
      FASTIFY_PROXY_BASE_URL: fastifyBase,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const apiProc = useFastifyProxy
    ? startProcess('pnpm', ['--filter', '@agentifui/api', 'dev'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'development',
          DATABASE_URL: databaseUrl,
          REDIS_URL: redisUrl,
          FASTIFY_API_HOST: '127.0.0.1',
          FASTIFY_API_PORT: String(fastifyPort),
          FASTIFY_LOG_LEVEL: process.env.FASTIFY_LOG_LEVEL || 'error',
          FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS: '30000',
          NEXT_UPSTREAM_BASE_URL: appBase,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : null;

  const stopAll = async exitCode => {
    await stopProcess(apiProc);
    await stopProcess(appProc);

    process.exit(exitCode);
  };

  let conversationId = null;
  let userAId = null;

  try {
    if (useFastifyProxy) {
      await waitForServer(`${fastifyBase}/healthz`, appReadyTimeoutMs);
    }
    await waitForServer(`${appBase}/api/auth/better/get-session`, appReadyTimeoutMs);

    if (useFastifyProxy) {
      const fastifyHealth = await requestWithCookies(
        new CookieJar(),
        `${appBase}/api/internal/fastify-health`,
        {
          method: 'GET',
        }
      );
      assertStatus(fastifyHealth, 200, 'fastify-health');
    }

    const jarA = new CookieJar();
    const jarB = new CookieJar();
    const passwordA = `M3DataA!${suffix}`;
    const passwordB = `M3DataB!${suffix}`;
    const userAEmail = `m3-a-${suffix}@example.com`;
    const userBEmail = `m3-b-${suffix}@example.com`;

    userAId = await signUpAndGetUserId(
      jarA,
      userAEmail,
      passwordA,
      `M3 User A ${suffix}`
    );
    const userBId = await signUpAndGetUserId(
      jarB,
      userBEmail,
      passwordB,
      `M3 User B ${suffix}`
    );

    const dbClient = new Client({ connectionString: databaseUrl });
    await dbClient.connect();
    try {
      await dbClient.query(
        `
          INSERT INTO profiles (id, email, auth_source, role, status, created_at, updated_at)
          VALUES ($1::uuid, $2, 'native', 'user', 'active', NOW(), NOW())
          ON CONFLICT (id) DO NOTHING
        `,
        [userAId, userAEmail]
      );
      await dbClient.query(
        `
          INSERT INTO profiles (id, email, auth_source, role, status, created_at, updated_at)
          VALUES ($1::uuid, $2, 'native', 'user', 'active', NOW(), NOW())
          ON CONFLICT (id) DO NOTHING
        `,
        [userBId, userBEmail]
      );

      const conversationExternalId = `m3-external-${suffix}`;
      const createConversation = await callInternalAction(
        jarA,
        'conversations.createConversation',
        {
          userId: userAId,
          conversation: {
            title: `M3 Internal Data ${suffix}`,
            status: 'active',
            external_id: conversationExternalId,
            app_id: 'chat-app',
            metadata: { source: 'm3-p2' },
          },
        }
      );
      assertStatus(
        createConversation.response,
        200,
        'conversations.createConversation'
      );
      assertInternalDataHandler(
        createConversation.response,
        'local',
        'conversations.createConversation',
        useFastifyProxy
      );
      if (!createConversation.body?.success || !createConversation.body?.data?.id) {
        throw new Error('conversations.createConversation should return created row');
      }
      conversationId = createConversation.body.data.id;

      const listByOwner = await callInternalAction(
        jarA,
        'conversations.getUserConversations',
        {
          userId: userAId,
          limit: 20,
          offset: 0,
        }
      );
      assertStatus(listByOwner.response, 200, 'conversations.getUserConversations');
      assertInternalDataHandler(
        listByOwner.response,
        'local',
        'conversations.getUserConversations',
        useFastifyProxy
      );
      if (!listByOwner.body?.success) {
        throw new Error('conversations.getUserConversations returned failure');
      }
      const ownerIds = new Set(
        (listByOwner.body.data?.conversations || []).map(item => item.id)
      );
      if (!ownerIds.has(conversationId)) {
        throw new Error('owner list does not include created conversation');
      }

      const byExternalId = await callInternalAction(
        jarA,
        'conversations.getConversationByExternalId',
        {
          userId: userAId,
          externalId: conversationExternalId,
        }
      );
      assertStatus(
        byExternalId.response,
        200,
        'conversations.getConversationByExternalId'
      );
      assertInternalDataHandler(
        byExternalId.response,
        'local',
        'conversations.getConversationByExternalId',
        useFastifyProxy
      );
      if (!byExternalId.body?.success || byExternalId.body?.data?.id !== conversationId) {
        throw new Error('conversations.getConversationByExternalId mismatch');
      }

      const renameByOther = await callInternalAction(
        jarB,
        'conversations.renameConversation',
        {
          userId: userBId,
          conversationId,
          title: 'forbidden rename',
        }
      );
      assertStatus(renameByOther.response, 200, 'conversations.renameConversation(other)');
      assertInternalDataHandler(
        renameByOther.response,
        'local',
        'conversations.renameConversation(other)',
        useFastifyProxy
      );
      if (!renameByOther.body?.success || renameByOther.body?.data !== false) {
        throw new Error('non-owner rename should return success=false payload');
      }

      const renameByOwner = await callInternalAction(
        jarA,
        'conversations.renameConversation',
        {
          userId: userAId,
          conversationId,
          title: 'owner renamed title',
        }
      );
      assertStatus(renameByOwner.response, 200, 'conversations.renameConversation(owner)');
      assertInternalDataHandler(
        renameByOwner.response,
        'local',
        'conversations.renameConversation(owner)',
        useFastifyProxy
      );
      if (!renameByOwner.body?.success || renameByOwner.body?.data !== true) {
        throw new Error('owner rename should succeed');
      }

      const saveUserMessage = await callInternalAction(jarA, 'messages.save', {
        message: {
          conversation_id: conversationId,
          role: 'user',
          content: `hello-${suffix}`,
          metadata: { from: 'm3-p2' },
        },
      });
      assertStatus(saveUserMessage.response, 200, 'messages.save(user)');
      assertInternalDataHandler(
        saveUserMessage.response,
        'local',
        'messages.save(user)',
        useFastifyProxy
      );
      if (!saveUserMessage.body?.success || !saveUserMessage.body?.data?.id) {
        throw new Error('messages.save(user) should return saved record');
      }

      const saveByOther = await callInternalAction(jarB, 'messages.save', {
        message: {
          conversation_id: conversationId,
          role: 'assistant',
          content: `forbidden-${suffix}`,
        },
      });
      assertStatus(saveByOther.response, 404, 'messages.save(other)');
      assertInternalDataHandler(
        saveByOther.response,
        'local',
        'messages.save(other)',
        useFastifyProxy
      );
      if (saveByOther.body?.success !== false) {
        throw new Error('messages.save(other) should fail for non-owner');
      }

      const findDuplicate = await callInternalAction(
        jarA,
        'messages.findDuplicate',
        {
          conversationId,
          content: `hello-${suffix}`,
          role: 'user',
        }
      );
      assertStatus(findDuplicate.response, 200, 'messages.findDuplicate');
      assertInternalDataHandler(
        findDuplicate.response,
        'local',
        'messages.findDuplicate',
        useFastifyProxy
      );
      if (!findDuplicate.body?.success || !findDuplicate.body?.data?.id) {
        throw new Error('messages.findDuplicate should return saved message');
      }

      const latestMessages = await callInternalAction(jarA, 'messages.getLatest', {
        conversationId,
        limit: 50,
      });
      assertStatus(latestMessages.response, 200, 'messages.getLatest');
      assertInternalDataHandler(
        latestMessages.response,
        'local',
        'messages.getLatest',
        useFastifyProxy
      );
      if (
        !latestMessages.body?.success ||
        !Array.isArray(latestMessages.body?.data) ||
        latestMessages.body.data.length === 0
      ) {
        throw new Error('messages.getLatest should return non-empty list');
      }

      const placeholderMessage = await callInternalAction(
        jarA,
        'messages.createPlaceholder',
        {
          conversationId,
          status: 'error',
          errorMessage: 'm3 placeholder',
        }
      );
      assertStatus(
        placeholderMessage.response,
        200,
        'messages.createPlaceholder'
      );
      assertInternalDataHandler(
        placeholderMessage.response,
        'local',
        'messages.createPlaceholder',
        useFastifyProxy
      );
      if (!placeholderMessage.body?.success || !placeholderMessage.body?.data?.id) {
        throw new Error('messages.createPlaceholder should return saved record');
      }

      const deleteByOther = await callInternalAction(
        jarB,
        'conversations.deleteConversation',
        {
          userId: userBId,
          conversationId,
        }
      );
      assertStatus(deleteByOther.response, 200, 'conversations.deleteConversation(other)');
      assertInternalDataHandler(
        deleteByOther.response,
        'local',
        'conversations.deleteConversation(other)',
        useFastifyProxy
      );
      if (!deleteByOther.body?.success || deleteByOther.body?.data !== false) {
        throw new Error('non-owner delete should return false');
      }

      const deleteByOwner = await callInternalAction(
        jarA,
        'conversations.deleteConversation',
        {
          userId: userAId,
          conversationId,
        }
      );
      assertStatus(deleteByOwner.response, 200, 'conversations.deleteConversation(owner)');
      assertInternalDataHandler(
        deleteByOwner.response,
        'local',
        'conversations.deleteConversation(owner)',
        useFastifyProxy
      );
      if (!deleteByOwner.body?.success || deleteByOwner.body?.data !== true) {
        throw new Error('owner delete should succeed');
      }

      const listAfterDelete = await callInternalAction(
        jarA,
        'conversations.getUserConversations',
        {
          userId: userAId,
          limit: 20,
          offset: 0,
        }
      );
      assertStatus(
        listAfterDelete.response,
        200,
        'conversations.getUserConversations(after delete)'
      );
      assertInternalDataHandler(
        listAfterDelete.response,
        'local',
        'conversations.getUserConversations(after delete)',
        useFastifyProxy
      );
      const activeIdsAfterDelete = new Set(
        (listAfterDelete.body?.data?.conversations || []).map(item => item.id)
      );
      if (activeIdsAfterDelete.has(conversationId)) {
        throw new Error('soft-deleted conversation should not appear in active list');
      }

      console.log(
        JSON.stringify(
          {
            ok: true,
            checks: {
              ownerCanList: true,
              ownerCanGetByExternalId: true,
              ownerCanCreateConversation: true,
              ownerCanRename: true,
              ownerCanDelete: true,
              nonOwnerRenameBlocked: true,
              nonOwnerDeleteBlocked: true,
              listExcludesDeleted: true,
              ownerCanSaveMessage: true,
              nonOwnerSaveMessageBlocked: true,
              ownerCanFindDuplicate: true,
              ownerCanListMessages: true,
              ownerCanCreatePlaceholder: true,
              localHandlerAsserted: useFastifyProxy,
            },
            userAId,
            userBId,
            conversationId,
          },
          null,
          2
        )
      );
    } finally {
      if (conversationId) {
        await dbClient.query('DELETE FROM conversations WHERE id = $1::uuid', [
          conversationId,
        ]);
      }
      await dbClient.end();
    }

    await stopAll(0);
  } catch (error) {
    console.error(
      '[m3-internal-data-e2e] failed:',
      error instanceof Error ? error.message : String(error)
    );
    await stopAll(1);
  }
}

main();
