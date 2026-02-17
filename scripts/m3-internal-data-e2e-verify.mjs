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
          FASTIFY_INTERNAL_DATA_LEGACY_FALLBACK_ENABLED:
            process.env.FASTIFY_INTERNAL_DATA_LEGACY_FALLBACK_ENABLED || '0',
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
  let executionId = null;
  let serviceInstanceId = null;
  let providerId = null;
  const createdGroupIds = [];
  const createdProviderIds = [];
  const createdServiceInstanceIds = [];
  const createdApiKeyIds = [];
  const createdSsoProviderIds = [];
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
          VALUES ($1::uuid, $2, 'native', 'admin', 'active', NOW(), NOW())
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
      await dbClient.query(
        `
          UPDATE profiles
          SET role = 'admin'::user_role,
              status = 'active'::account_status,
              updated_at = NOW()
          WHERE id = $1::uuid
        `,
        [userAId]
      );

      const providerInsert = await dbClient.query(
        `
          INSERT INTO providers (
            name,
            type,
            base_url,
            auth_type,
            is_active,
            is_default,
            created_at,
            updated_at
          )
          VALUES ($1, 'dify', 'https://example.com', 'bearer', TRUE, FALSE, NOW(), NOW())
          RETURNING id::text
        `,
        [`m3-provider-${suffix}`]
      );
      providerId = providerInsert.rows[0]?.id || null;
      if (!providerId) {
        throw new Error('failed to seed provider for app execution test');
      }

      const serviceInstanceInsert = await dbClient.query(
        `
          INSERT INTO service_instances (
            provider_id,
            instance_id,
            api_path,
            display_name,
            description,
            is_default,
            visibility,
            config,
            created_at,
            updated_at
          )
          VALUES (
            $1::uuid,
            $2,
            '/v1',
            $3,
            NULL,
            TRUE,
            'private',
            '{}'::jsonb,
            NOW(),
            NOW()
          )
          RETURNING id::text
        `,
        [providerId, `m3-instance-${suffix}`, `M3 Instance ${suffix}`]
      );
      serviceInstanceId = serviceInstanceInsert.rows[0]?.id || null;
      if (!serviceInstanceId) {
        throw new Error('failed to seed service instance for app execution test');
      }

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

      const createExecution = await callInternalAction(
        jarA,
        'appExecutions.create',
        {
          execution: {
            service_instance_id: serviceInstanceId,
            execution_type: 'workflow',
            title: `M3 Execution ${suffix}`,
            inputs: { prompt: 'hello' },
            metadata: { source: 'm3-p3' },
          },
        }
      );
      assertStatus(createExecution.response, 200, 'appExecutions.create');
      assertInternalDataHandler(
        createExecution.response,
        'local',
        'appExecutions.create',
        useFastifyProxy
      );
      if (!createExecution.body?.success || !createExecution.body?.data?.id) {
        throw new Error('appExecutions.create should return saved row');
      }
      executionId = createExecution.body.data.id;

      const getExecutionById = await callInternalAction(jarA, 'appExecutions.getById', {
        userId: userAId,
        executionId,
      });
      assertStatus(getExecutionById.response, 200, 'appExecutions.getById(owner)');
      assertInternalDataHandler(
        getExecutionById.response,
        'local',
        'appExecutions.getById(owner)',
        useFastifyProxy
      );
      if (!getExecutionById.body?.success || getExecutionById.body?.data?.id !== executionId) {
        throw new Error('appExecutions.getById(owner) mismatch');
      }

      const getExecutionByOther = await callInternalAction(
        jarB,
        'appExecutions.getById',
        {
          userId: userBId,
          executionId,
        }
      );
      assertStatus(getExecutionByOther.response, 200, 'appExecutions.getById(other)');
      assertInternalDataHandler(
        getExecutionByOther.response,
        'local',
        'appExecutions.getById(other)',
        useFastifyProxy
      );
      if (!getExecutionByOther.body?.success || getExecutionByOther.body?.data !== null) {
        throw new Error('appExecutions.getById(other) should return null');
      }

      const listExecutions = await callInternalAction(
        jarA,
        'appExecutions.getByServiceInstance',
        {
          userId: userAId,
          serviceInstanceId,
          limit: 20,
        }
      );
      assertStatus(
        listExecutions.response,
        200,
        'appExecutions.getByServiceInstance'
      );
      assertInternalDataHandler(
        listExecutions.response,
        'local',
        'appExecutions.getByServiceInstance',
        useFastifyProxy
      );
      const executionIds = new Set((listExecutions.body?.data || []).map(item => item.id));
      if (!listExecutions.body?.success || !executionIds.has(executionId)) {
        throw new Error('appExecutions.getByServiceInstance should include created record');
      }

      const updateStatusByOther = await callInternalAction(
        jarB,
        'appExecutions.updateStatus',
        {
          userId: userBId,
          executionId,
          status: 'failed',
        }
      );
      assertStatus(
        updateStatusByOther.response,
        404,
        'appExecutions.updateStatus(other)'
      );
      assertInternalDataHandler(
        updateStatusByOther.response,
        'local',
        'appExecutions.updateStatus(other)',
        useFastifyProxy
      );

      const updateStatusByOwner = await callInternalAction(
        jarA,
        'appExecutions.updateStatus',
        {
          userId: userAId,
          executionId,
          status: 'running',
        }
      );
      assertStatus(
        updateStatusByOwner.response,
        200,
        'appExecutions.updateStatus(owner)'
      );
      assertInternalDataHandler(
        updateStatusByOwner.response,
        'local',
        'appExecutions.updateStatus(owner)',
        useFastifyProxy
      );
      if (!updateStatusByOwner.body?.success || updateStatusByOwner.body?.data !== true) {
        throw new Error('appExecutions.updateStatus(owner) should return true');
      }

      const updateCompleteByOwner = await callInternalAction(
        jarA,
        'appExecutions.updateComplete',
        {
          userId: userAId,
          executionId,
          completeData: {
            status: 'completed',
            outputs: { answer: 'ok' },
            total_steps: 1,
            total_tokens: 10,
            elapsed_time: 0.123,
            metadata: { source: 'm3-p3-complete' },
          },
        }
      );
      assertStatus(
        updateCompleteByOwner.response,
        200,
        'appExecutions.updateComplete(owner)'
      );
      assertInternalDataHandler(
        updateCompleteByOwner.response,
        'local',
        'appExecutions.updateComplete(owner)',
        useFastifyProxy
      );
      if (
        !updateCompleteByOwner.body?.success ||
        updateCompleteByOwner.body?.data?.status !== 'completed'
      ) {
        throw new Error('appExecutions.updateComplete(owner) should return completed row');
      }

      const deleteExecutionByOwner = await callInternalAction(
        jarA,
        'appExecutions.delete',
        {
          userId: userAId,
          executionId,
        }
      );
      assertStatus(
        deleteExecutionByOwner.response,
        200,
        'appExecutions.delete(owner)'
      );
      assertInternalDataHandler(
        deleteExecutionByOwner.response,
        'local',
        'appExecutions.delete(owner)',
        useFastifyProxy
      );
      if (!deleteExecutionByOwner.body?.success || deleteExecutionByOwner.body?.data !== true) {
        throw new Error('appExecutions.delete(owner) should return true');
      }

      const listExecutionsAfterDelete = await callInternalAction(
        jarA,
        'appExecutions.getByServiceInstance',
        {
          userId: userAId,
          serviceInstanceId,
          limit: 20,
        }
      );
      assertStatus(
        listExecutionsAfterDelete.response,
        200,
        'appExecutions.getByServiceInstance(after delete)'
      );
      assertInternalDataHandler(
        listExecutionsAfterDelete.response,
        'local',
        'appExecutions.getByServiceInstance(after delete)',
        useFastifyProxy
      );
      const executionIdsAfterDelete = new Set(
        (listExecutionsAfterDelete.body?.data || []).map(item => item.id)
      );
      if (executionIdsAfterDelete.has(executionId)) {
        throw new Error('soft-deleted execution should not appear in list');
      }

      const userStats = await callInternalAction(jarA, 'users.getUserStats', {});
      assertStatus(userStats.response, 200, 'users.getUserStats');
      assertInternalDataHandler(
        userStats.response,
        'local',
        'users.getUserStats',
        useFastifyProxy
      );
      if (!userStats.body?.success || !userStats.body?.data?.totalUsers) {
        throw new Error('users.getUserStats should return populated stats');
      }

      const createGroup = await callInternalAction(jarA, 'groups.createGroup', {
        data: {
          name: `M3 Group ${suffix}`,
          description: 'm3 admin group',
        },
      });
      assertStatus(createGroup.response, 200, 'groups.createGroup');
      assertInternalDataHandler(
        createGroup.response,
        'local',
        'groups.createGroup',
        useFastifyProxy
      );
      const groupId = createGroup.body?.data?.id;
      if (!createGroup.body?.success || !groupId) {
        throw new Error('groups.createGroup should return group id');
      }
      createdGroupIds.push(groupId);

      const addGroupMember = await callInternalAction(
        jarA,
        'groups.addGroupMember',
        {
          groupId,
          userId: userBId,
        }
      );
      assertStatus(addGroupMember.response, 200, 'groups.addGroupMember');
      assertInternalDataHandler(
        addGroupMember.response,
        'local',
        'groups.addGroupMember',
        useFastifyProxy
      );
      if (!addGroupMember.body?.success || !addGroupMember.body?.data?.id) {
        throw new Error('groups.addGroupMember should return membership row');
      }

      const createProviderByAdmin = await callInternalAction(
        jarA,
        'providers.createProvider',
        {
          provider: {
            name: `M3 Admin Provider ${suffix}`,
            type: 'dify',
            base_url: 'https://example.net',
            auth_type: 'bearer',
            is_active: true,
            is_default: false,
          },
        }
      );
      assertStatus(createProviderByAdmin.response, 200, 'providers.createProvider');
      assertInternalDataHandler(
        createProviderByAdmin.response,
        'local',
        'providers.createProvider',
        useFastifyProxy
      );
      const adminProviderId = createProviderByAdmin.body?.data?.id;
      if (!createProviderByAdmin.body?.success || !adminProviderId) {
        throw new Error('providers.createProvider should return provider id');
      }
      createdProviderIds.push(adminProviderId);

      const createServiceInstanceByAdmin = await callInternalAction(
        jarA,
        'serviceInstances.create',
        {
          serviceInstance: {
            provider_id: adminProviderId,
            instance_id: `m3-admin-instance-${suffix}`,
            api_path: '/v1',
            display_name: `M3 Admin Instance ${suffix}`,
            description: 'm3 admin instance',
            is_default: true,
            visibility: 'group_only',
            config: {},
          },
        }
      );
      if (createServiceInstanceByAdmin.response.status !== 200) {
        throw new Error(
          `serviceInstances.create returned ${createServiceInstanceByAdmin.response.status}: ${JSON.stringify(createServiceInstanceByAdmin.body)}`
        );
      }
      assertInternalDataHandler(
        createServiceInstanceByAdmin.response,
        'local',
        'serviceInstances.create',
        useFastifyProxy
      );
      const adminServiceInstanceId = createServiceInstanceByAdmin.body?.data?.id;
      if (!createServiceInstanceByAdmin.body?.success || !adminServiceInstanceId) {
        throw new Error('serviceInstances.create should return service instance id');
      }
      createdServiceInstanceIds.push(adminServiceInstanceId);

      const setGroupPermission = await callInternalAction(
        jarA,
        'groups.setGroupAppPermission',
        {
          groupId,
          serviceInstanceId: adminServiceInstanceId,
          data: {
            is_enabled: true,
            usage_quota: 5,
          },
        }
      );
      assertStatus(
        setGroupPermission.response,
        200,
        'groups.setGroupAppPermission'
      );
      assertInternalDataHandler(
        setGroupPermission.response,
        'local',
        'groups.setGroupAppPermission',
        useFastifyProxy
      );
      if (!setGroupPermission.body?.success) {
        throw new Error('groups.setGroupAppPermission should succeed');
      }

      const checkPermissionByUser = await callInternalAction(
        jarB,
        'groups.checkUserAppPermission',
        {
          userId: userBId,
          serviceInstanceId: adminServiceInstanceId,
        }
      );
      assertStatus(
        checkPermissionByUser.response,
        200,
        'groups.checkUserAppPermission'
      );
      assertInternalDataHandler(
        checkPermissionByUser.response,
        'local',
        'groups.checkUserAppPermission',
        useFastifyProxy
      );
      if (
        !checkPermissionByUser.body?.success ||
        checkPermissionByUser.body?.data?.has_access !== true
      ) {
        throw new Error('groups.checkUserAppPermission should allow group member');
      }

      const incrementUsageByUser = await callInternalAction(
        jarB,
        'groups.incrementAppUsage',
        {
          userId: userBId,
          serviceInstanceId: adminServiceInstanceId,
          increment: 1,
        }
      );
      assertStatus(incrementUsageByUser.response, 200, 'groups.incrementAppUsage');
      assertInternalDataHandler(
        incrementUsageByUser.response,
        'local',
        'groups.incrementAppUsage',
        useFastifyProxy
      );
      if (
        !incrementUsageByUser.body?.success ||
        incrementUsageByUser.body?.data?.success !== true
      ) {
        throw new Error('groups.incrementAppUsage should succeed');
      }

      const listAccessibleAppsByUser = await callInternalAction(
        jarB,
        'groups.getUserAccessibleApps',
        {
          userId: userBId,
        }
      );
      assertStatus(
        listAccessibleAppsByUser.response,
        200,
        'groups.getUserAccessibleApps'
      );
      assertInternalDataHandler(
        listAccessibleAppsByUser.response,
        'local',
        'groups.getUserAccessibleApps',
        useFastifyProxy
      );
      const accessibleIds = new Set(
        (listAccessibleAppsByUser.body?.data || []).map(item => item.service_instance_id)
      );
      if (!accessibleIds.has(adminServiceInstanceId)) {
        throw new Error('groups.getUserAccessibleApps should include group-only app');
      }

      const createApiKey = await callInternalAction(jarA, 'apiKeys.create', {
        apiKey: {
          provider_id: adminProviderId,
          service_instance_id: adminServiceInstanceId,
          user_id: null,
          key_value: 'enc:dummy-key',
          is_default: true,
          usage_count: 0,
          last_used_at: null,
        },
        isEncrypted: true,
      });
      assertStatus(createApiKey.response, 200, 'apiKeys.create');
      assertInternalDataHandler(
        createApiKey.response,
        'local',
        'apiKeys.create',
        useFastifyProxy
      );
      const apiKeyId = createApiKey.body?.data?.id;
      if (!createApiKey.body?.success || !apiKeyId) {
        throw new Error('apiKeys.create should return key id');
      }
      createdApiKeyIds.push(apiKeyId);

      const getApiKeyByService = await callInternalAction(
        jarA,
        'apiKeys.getByServiceInstance',
        {
          serviceInstanceId: adminServiceInstanceId,
        }
      );
      assertStatus(
        getApiKeyByService.response,
        200,
        'apiKeys.getByServiceInstance'
      );
      assertInternalDataHandler(
        getApiKeyByService.response,
        'local',
        'apiKeys.getByServiceInstance',
        useFastifyProxy
      );
      if (!getApiKeyByService.body?.success || getApiKeyByService.body?.data?.id !== apiKeyId) {
        throw new Error('apiKeys.getByServiceInstance should return created key');
      }

      const deleteApiKey = await callInternalAction(jarA, 'apiKeys.delete', {
        id: apiKeyId,
      });
      assertStatus(deleteApiKey.response, 200, 'apiKeys.delete');
      assertInternalDataHandler(
        deleteApiKey.response,
        'local',
        'apiKeys.delete',
        useFastifyProxy
      );
      if (!deleteApiKey.body?.success || deleteApiKey.body?.data !== true) {
        throw new Error('apiKeys.delete should return true');
      }

      const createSsoProvider = await callInternalAction(
        jarA,
        'sso.createSsoProvider',
        {
          data: {
            name: `M3 SSO ${suffix}`,
            protocol: 'OIDC',
            settings: { issuer: 'https://idp.example.com' },
            enabled: true,
            display_order: 1,
            button_text: 'Sign in',
          },
        }
      );
      assertStatus(createSsoProvider.response, 200, 'sso.createSsoProvider');
      assertInternalDataHandler(
        createSsoProvider.response,
        'local',
        'sso.createSsoProvider',
        useFastifyProxy
      );
      const ssoProviderId = createSsoProvider.body?.data?.id;
      if (!createSsoProvider.body?.success || !ssoProviderId) {
        throw new Error('sso.createSsoProvider should return provider id');
      }
      createdSsoProviderIds.push(ssoProviderId);

      const toggleSsoProvider = await callInternalAction(
        jarA,
        'sso.toggleSsoProvider',
        {
          id: ssoProviderId,
          enabled: false,
        }
      );
      assertStatus(toggleSsoProvider.response, 200, 'sso.toggleSsoProvider');
      assertInternalDataHandler(
        toggleSsoProvider.response,
        'local',
        'sso.toggleSsoProvider',
        useFastifyProxy
      );
      if (!toggleSsoProvider.body?.success || toggleSsoProvider.body?.data?.enabled !== false) {
        throw new Error('sso.toggleSsoProvider should update enabled flag');
      }

      const updateSsoOrder = await callInternalAction(
        jarA,
        'sso.updateSsoProviderOrder',
        {
          updates: [{ id: ssoProviderId, display_order: 9 }],
        }
      );
      assertStatus(updateSsoOrder.response, 200, 'sso.updateSsoProviderOrder');
      assertInternalDataHandler(
        updateSsoOrder.response,
        'local',
        'sso.updateSsoProviderOrder',
        useFastifyProxy
      );
      if (!updateSsoOrder.body?.success) {
        throw new Error('sso.updateSsoProviderOrder should succeed');
      }

      const unsupportedAction = await callInternalAction(jarA, 'foo.bar', {});
      assertStatus(unsupportedAction.response, 400, 'unsupported action');
      assertInternalDataHandler(
        unsupportedAction.response,
        'local',
        'unsupported action',
        useFastifyProxy
      );
      if (
        unsupportedAction.body?.success !== false ||
        !String(unsupportedAction.body?.error || '').includes('Unsupported action')
      ) {
        throw new Error('unsupported action should return local 400 response');
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
              ownerCanCreateExecution: true,
              ownerCanListExecutions: true,
              ownerCanGetExecutionById: true,
              nonOwnerExecutionGetIsNull: true,
              nonOwnerExecutionStatusBlocked: true,
              ownerCanUpdateExecutionStatus: true,
              ownerCanUpdateExecutionComplete: true,
              ownerCanDeleteExecution: true,
              executionListExcludesDeleted: true,
              adminCanGetUserStats: true,
              adminCanCreateGroup: true,
              adminCanAddGroupMember: true,
              adminCanCreateProvider: true,
              adminCanCreateServiceInstance: true,
              adminCanSetGroupPermission: true,
              userCanCheckGroupPermission: true,
              userCanIncrementGroupUsage: true,
              userCanGetAccessibleApps: true,
              adminCanCreateApiKey: true,
              adminCanGetApiKeyByServiceInstance: true,
              adminCanDeleteApiKey: true,
              adminCanCreateSsoProvider: true,
              adminCanToggleSsoProvider: true,
              adminCanUpdateSsoOrder: true,
              unsupportedActionHandledLocally: true,
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
      if (createdSsoProviderIds.length > 0) {
        await dbClient.query(
          `DELETE FROM sso_providers WHERE id = ANY($1::uuid[])`,
          [createdSsoProviderIds]
        );
      }
      if (createdApiKeyIds.length > 0) {
        await dbClient.query(`DELETE FROM api_keys WHERE id = ANY($1::uuid[])`, [
          createdApiKeyIds,
        ]);
      }
      if (createdServiceInstanceIds.length > 0) {
        await dbClient.query(
          `DELETE FROM service_instances WHERE id = ANY($1::uuid[])`,
          [createdServiceInstanceIds]
        );
      }
      if (createdProviderIds.length > 0) {
        await dbClient.query(`DELETE FROM providers WHERE id = ANY($1::uuid[])`, [
          createdProviderIds,
        ]);
      }
      if (createdGroupIds.length > 0) {
        await dbClient.query(`DELETE FROM groups WHERE id = ANY($1::uuid[])`, [
          createdGroupIds,
        ]);
      }
      if (executionId) {
        await dbClient.query('DELETE FROM app_executions WHERE id = $1::uuid', [
          executionId,
        ]);
      }
      if (conversationId) {
        await dbClient.query('DELETE FROM conversations WHERE id = $1::uuid', [
          conversationId,
        ]);
      }
      if (serviceInstanceId) {
        await dbClient.query('DELETE FROM service_instances WHERE id = $1::uuid', [
          serviceInstanceId,
        ]);
      }
      if (providerId) {
        await dbClient.query('DELETE FROM providers WHERE id = $1::uuid', [
          providerId,
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
