#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

loadEnv({ path: '.env.test-stack' });

const appPort = Number(process.env.M3_INTERNAL_DATA_APP_PORT || 3316);
const appBase = `http://127.0.0.1:${appPort}`;
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

  let conversationId = null;
  let userAId = null;

  try {
    await waitForServer(`${appBase}/api/auth/better/get-session`, appReadyTimeoutMs);

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

      const createConversation = await dbClient.query(
        `
          INSERT INTO conversations (
            user_id,
            ai_config_id,
            title,
            summary,
            settings,
            metadata,
            status,
            external_id,
            app_id,
            last_message_preview
          )
          VALUES (
            $1::uuid,
            NULL,
            $2,
            NULL,
            '{}'::jsonb,
            '{}'::jsonb,
            'active',
            NULL,
            'chat-app',
            NULL
          )
          RETURNING id::text
        `,
        [userAId, `M3 Internal Data ${suffix}`]
      );
      conversationId = createConversation.rows[0]?.id || null;
      if (!conversationId) {
        throw new Error('failed to seed conversation for internal data test');
      }

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
      if (!listByOwner.body?.success) {
        throw new Error('conversations.getUserConversations returned failure');
      }
      const ownerIds = new Set(
        (listByOwner.body.data?.conversations || []).map(item => item.id)
      );
      if (!ownerIds.has(conversationId)) {
        throw new Error('owner list does not include seeded conversation');
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
      if (!renameByOwner.body?.success || renameByOwner.body?.data !== true) {
        throw new Error('owner rename should succeed');
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
              ownerCanRename: true,
              ownerCanDelete: true,
              nonOwnerRenameBlocked: true,
              nonOwnerDeleteBlocked: true,
              listExcludesDeleted: true,
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
