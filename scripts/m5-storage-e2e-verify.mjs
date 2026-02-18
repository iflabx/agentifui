#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from 'pg';

loadEnv({ path: '.env.test-stack' });

const appPort = Number(process.env.M5_STORAGE_APP_PORT || 3319);
const appBase = `http://127.0.0.1:${appPort}`;
const appReadyTimeoutMs = Number(
  process.env.M5_STORAGE_READY_TIMEOUT_MS || 120000
);
const appStartRetryCount = Math.max(
  1,
  Number(process.env.M5_STORAGE_APP_START_RETRIES || 2)
);
const expectLegacyRelay = parseBooleanEnv(
  process.env.M5_STORAGE_EXPECT_LEGACY_RELAY,
  false
);

const fallbackDatabaseUrl =
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui';
const fallbackRedisUrl = 'redis://172.20.0.1:6379/0';
const fallbackS3Endpoint = 'http://172.20.0.1:9000';

const tinyPngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7YJ7sAAAAASUVORK5CYII=',
  'base64'
);

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

async function requestForm(jar, path, method, formData) {
  const response = await requestWithCookies(jar, `${appBase}${path}`, {
    method,
    headers: {
      origin: appBase,
      referer: `${appBase}/`,
    },
    body: formData,
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

function createImageBlob() {
  return new Blob([tinyPngBytes], { type: 'image/png' });
}

async function main() {
  const suffix = randomSuffix();
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    process.env.M5_STORAGE_DATABASE_URL?.trim() ||
    fallbackDatabaseUrl;
  const redisUrl =
    process.env.REDIS_URL?.trim() ||
    process.env.M5_STORAGE_REDIS_URL?.trim() ||
    fallbackRedisUrl;
  const s3Endpoint =
    process.env.S3_ENDPOINT?.trim() ||
    process.env.M5_STORAGE_S3_ENDPOINT?.trim() ||
    fallbackS3Endpoint;
  const publicReadEnabled = parseBooleanEnv(
    process.env.S3_PUBLIC_READ_ENABLED,
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
    STORAGE_LEGACY_RELAY_ENABLED:
      process.env.STORAGE_LEGACY_RELAY_ENABLED ||
      (expectLegacyRelay ? '1' : '0'),
    NEXT_PUBLIC_STORAGE_LEGACY_RELAY_ENABLED:
      process.env.NEXT_PUBLIC_STORAGE_LEGACY_RELAY_ENABLED ||
      (expectLegacyRelay ? '1' : '0'),
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_DISABLE_SWC_WORKER: process.env.NEXT_DISABLE_SWC_WORKER || '1',
  };

  let appProc = null;

  let userAAvatarPath = null;
  let userAContentImagePath = null;
  let contentPublicUrl = null;
  let exitCode = 0;

  const dbClient = new Client({ connectionString: databaseUrl });

  try {
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
            `[m5-storage-e2e] app start attempt ${attempt}/${appStartRetryCount} failed, retrying...`
          );
          await sleep(1500);
        }
      }
    }

    if (lastStartupError) {
      throw lastStartupError;
    }

    const jarA = new CookieJar();
    const jarB = new CookieJar();
    const userAEmail = `m5-a-${suffix}@example.com`;
    const userBEmail = `m5-b-${suffix}@example.com`;
    const userAPassword = `M5A!${suffix}`;
    const userBPassword = `M5B!${suffix}`;

    const userAId = await signUpAndGetUserId(
      jarA,
      userAEmail,
      userAPassword,
      `M5 User A ${suffix}`
    );
    const userBId = await signUpAndGetUserId(
      jarB,
      userBEmail,
      userBPassword,
      `M5 User B ${suffix}`
    );

    await dbClient.connect();
    await ensureProfileRow(dbClient, userAId, userAEmail);
    await ensureProfileRow(dbClient, userBId, userBEmail);

    const avatarPresign = await requestJson(
      jarA,
      '/api/internal/storage/avatar/presign',
      'POST',
      {
        userId: userAId,
        fileName: 'avatar.png',
        contentType: 'image/png',
        fileSize: tinyPngBytes.byteLength,
      }
    );
    assertStatus(avatarPresign.response, 200, 'avatar/presign owner');

    const avatarUploadUrl = avatarPresign.payload?.uploadUrl;
    userAAvatarPath = avatarPresign.payload?.path;
    if (!avatarUploadUrl || !userAAvatarPath) {
      throw new Error('avatar presign payload missing uploadUrl/path');
    }

    const avatarUpload = await fetch(avatarUploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/png',
      },
      body: tinyPngBytes,
    });
    if (!avatarUpload.ok) {
      throw new Error(`avatar direct upload failed: ${avatarUpload.status}`);
    }

    const avatarCommit = await requestJson(
      jarA,
      '/api/internal/storage/avatar',
      'POST',
      {
        userId: userAId,
        path: userAAvatarPath,
      }
    );
    assertStatus(avatarCommit.response, 200, 'avatar commit owner');
    if (!avatarCommit.payload?.success || !avatarCommit.payload?.url) {
      throw new Error('avatar commit response missing url');
    }

    const profileAvatarRow = await dbClient.query(
      `
        SELECT avatar_url
        FROM profiles
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [userAId]
    );
    if (profileAvatarRow.rows[0]?.avatar_url !== avatarCommit.payload.url) {
      throw new Error('avatar url not persisted to profile');
    }

    const avatarDownloadOwner = await requestWithCookies(
      jarA,
      `${appBase}/api/internal/storage/avatar/presign?${new URLSearchParams({
        userId: userAId,
        path: userAAvatarPath,
      }).toString()}`,
      {
        method: 'GET',
      }
    );
    assertStatus(avatarDownloadOwner, 200, 'avatar download presign owner');
    const avatarDownloadOwnerPayload = await avatarDownloadOwner
      .json()
      .catch(() => null);
    const avatarDownloadUrl = avatarDownloadOwnerPayload?.downloadUrl;
    if (!avatarDownloadUrl) {
      throw new Error('avatar download presign missing downloadUrl');
    }

    const avatarDownloadResponse = await fetch(avatarDownloadUrl, {
      method: 'GET',
    });
    if (!avatarDownloadResponse.ok) {
      throw new Error(
        `avatar download failed: ${avatarDownloadResponse.status}`
      );
    }
    const avatarDownloadBytes = Buffer.from(
      await avatarDownloadResponse.arrayBuffer()
    );
    if (avatarDownloadBytes.byteLength !== tinyPngBytes.byteLength) {
      throw new Error('avatar download byte length mismatch');
    }

    const avatarPresignCrossUser = await requestJson(
      jarB,
      '/api/internal/storage/avatar/presign',
      'POST',
      {
        userId: userAId,
        fileName: 'hijack.png',
        contentType: 'image/png',
        fileSize: tinyPngBytes.byteLength,
      }
    );
    assertStatus(
      avatarPresignCrossUser.response,
      403,
      'avatar/presign cross-user'
    );

    const avatarCommitCrossUser = await requestJson(
      jarB,
      '/api/internal/storage/avatar',
      'POST',
      {
        userId: userAId,
        path: userAAvatarPath,
      }
    );
    assertStatus(
      avatarCommitCrossUser.response,
      403,
      'avatar commit cross-user'
    );

    const avatarDownloadCrossUser = await requestWithCookies(
      jarB,
      `${appBase}/api/internal/storage/avatar/presign?${new URLSearchParams({
        userId: userAId,
        path: userAAvatarPath,
      }).toString()}`,
      {
        method: 'GET',
      }
    );
    assertStatus(
      avatarDownloadCrossUser,
      publicReadEnabled ? 200 : 403,
      'avatar download presign cross-user'
    );

    const avatarDelete = await requestJson(
      jarA,
      '/api/internal/storage/avatar',
      'DELETE',
      {
        userId: userAId,
        filePath: userAAvatarPath,
      }
    );
    assertStatus(avatarDelete.response, 200, 'avatar delete owner');

    const profileAfterDelete = await dbClient.query(
      `
        SELECT avatar_url
        FROM profiles
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [userAId]
    );
    if (profileAfterDelete.rows[0]?.avatar_url !== null) {
      throw new Error('avatar_url expected NULL after delete');
    }

    const contentPresign = await requestJson(
      jarA,
      '/api/internal/storage/content-images/presign',
      'POST',
      {
        userId: userAId,
        fileName: 'content.png',
        contentType: 'image/png',
        fileSize: tinyPngBytes.byteLength,
      }
    );
    assertStatus(contentPresign.response, 200, 'content-images/presign owner');

    const contentUploadUrl = contentPresign.payload?.uploadUrl;
    userAContentImagePath = contentPresign.payload?.path;
    if (!contentUploadUrl || !userAContentImagePath) {
      throw new Error('content image presign payload missing uploadUrl/path');
    }

    const contentUpload = await fetch(contentUploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/png',
      },
      body: tinyPngBytes,
    });
    if (!contentUpload.ok) {
      throw new Error(
        `content image direct upload failed: ${contentUpload.status}`
      );
    }

    const contentCommit = await requestJson(
      jarA,
      '/api/internal/storage/content-images',
      'POST',
      {
        userId: userAId,
        path: userAContentImagePath,
      }
    );
    assertStatus(contentCommit.response, 200, 'content-images commit owner');
    contentPublicUrl = contentCommit.payload?.url;
    if (!contentCommit.payload?.success || !contentPublicUrl) {
      throw new Error('content image commit response missing url');
    }

    const contentDownloadOwner = await requestWithCookies(
      jarA,
      `${appBase}/api/internal/storage/content-images/presign?${new URLSearchParams(
        {
          userId: userAId,
          path: userAContentImagePath,
        }
      ).toString()}`,
      {
        method: 'GET',
      }
    );
    assertStatus(
      contentDownloadOwner,
      200,
      'content-images download presign owner'
    );
    const contentDownloadOwnerPayload = await contentDownloadOwner
      .json()
      .catch(() => null);
    const contentDownloadUrl = contentDownloadOwnerPayload?.downloadUrl;
    if (!contentDownloadUrl) {
      throw new Error('content image download presign missing downloadUrl');
    }

    const contentDownloadResponse = await fetch(contentDownloadUrl, {
      method: 'GET',
    });
    if (!contentDownloadResponse.ok) {
      throw new Error(
        `content image download failed: ${contentDownloadResponse.status}`
      );
    }
    const contentDownloadBytes = Buffer.from(
      await contentDownloadResponse.arrayBuffer()
    );
    if (contentDownloadBytes.byteLength !== tinyPngBytes.byteLength) {
      throw new Error('content image download byte length mismatch');
    }

    const listOwner = await requestWithCookies(
      jarA,
      `${appBase}/api/internal/storage/content-images?userId=${encodeURIComponent(userAId)}`,
      {
        method: 'GET',
      }
    );
    assertStatus(listOwner, 200, 'content-images list owner');
    const listOwnerPayload = await listOwner.json().catch(() => null);
    if (!listOwnerPayload?.success || !Array.isArray(listOwnerPayload.files)) {
      throw new Error('content image list owner missing files');
    }
    if (!listOwnerPayload.files.includes(userAContentImagePath)) {
      throw new Error('content image path not found in owner list');
    }

    const listCrossUser = await requestWithCookies(
      jarB,
      `${appBase}/api/internal/storage/content-images?userId=${encodeURIComponent(userAId)}`,
      {
        method: 'GET',
      }
    );
    assertStatus(listCrossUser, 403, 'content-images list cross-user');

    const deleteCrossUser = await requestJson(
      jarB,
      '/api/internal/storage/content-images',
      'DELETE',
      {
        userId: userAId,
        filePath: userAContentImagePath,
      }
    );
    assertStatus(
      deleteCrossUser.response,
      403,
      'content-images delete cross-user'
    );

    const contentCommitCrossUser = await requestJson(
      jarB,
      '/api/internal/storage/content-images',
      'POST',
      {
        userId: userAId,
        path: userAContentImagePath,
      }
    );
    assertStatus(
      contentCommitCrossUser.response,
      403,
      'content-images commit cross-user'
    );

    const contentDownloadCrossUser = await requestWithCookies(
      jarB,
      `${appBase}/api/internal/storage/content-images/presign?${new URLSearchParams(
        {
          userId: userAId,
          path: userAContentImagePath,
        }
      ).toString()}`,
      {
        method: 'GET',
      }
    );
    assertStatus(
      contentDownloadCrossUser,
      publicReadEnabled ? 200 : 403,
      'content-images download presign cross-user'
    );

    if (contentPublicUrl) {
      const directRead = await fetch(contentPublicUrl, { method: 'GET' });
      if (publicReadEnabled && !directRead.ok) {
        throw new Error(
          `expected public content URL readable, got ${directRead.status}`
        );
      }
      if (!publicReadEnabled && directRead.ok) {
        throw new Error(
          'expected private content URL to reject anonymous direct read'
        );
      }
    }

    const contentDelete = await requestJson(
      jarA,
      '/api/internal/storage/content-images',
      'DELETE',
      {
        userId: userAId,
        filePath: userAContentImagePath,
      }
    );
    assertStatus(contentDelete.response, 200, 'content-images delete owner');

    let legacyAvatarFallback = false;
    let legacyContentFallback = false;
    let legacyAvatarRelayDisabled = false;
    let legacyContentRelayDisabled = false;

    if (expectLegacyRelay) {
      const legacyAvatarForm = new FormData();
      legacyAvatarForm.append('file', createImageBlob(), 'legacy-avatar.png');
      legacyAvatarForm.append('userId', userAId);
      const legacyAvatar = await requestForm(
        jarA,
        '/api/internal/storage/avatar',
        'POST',
        legacyAvatarForm
      );
      assertStatus(legacyAvatar.response, 200, 'avatar legacy upload');
      const legacyAvatarPath = legacyAvatar.payload?.path;
      if (!legacyAvatarPath) {
        throw new Error('avatar legacy upload missing path');
      }

      const legacyAvatarDelete = await requestJson(
        jarA,
        '/api/internal/storage/avatar',
        'DELETE',
        {
          userId: userAId,
          filePath: legacyAvatarPath,
        }
      );
      assertStatus(legacyAvatarDelete.response, 200, 'avatar legacy delete');

      const legacyContentForm = new FormData();
      legacyContentForm.append('file', createImageBlob(), 'legacy-content.png');
      legacyContentForm.append('userId', userAId);
      const legacyContent = await requestForm(
        jarA,
        '/api/internal/storage/content-images',
        'POST',
        legacyContentForm
      );
      assertStatus(legacyContent.response, 200, 'content-images legacy upload');
      const legacyContentPath = legacyContent.payload?.path;
      if (!legacyContentPath) {
        throw new Error('content-images legacy upload missing path');
      }

      const legacyContentDelete = await requestJson(
        jarA,
        '/api/internal/storage/content-images',
        'DELETE',
        {
          userId: userAId,
          filePath: legacyContentPath,
        }
      );
      assertStatus(
        legacyContentDelete.response,
        200,
        'content-images legacy delete'
      );

      legacyAvatarFallback = true;
      legacyContentFallback = true;
    } else {
      const legacyAvatarForm = new FormData();
      legacyAvatarForm.append('file', createImageBlob(), 'legacy-avatar.png');
      legacyAvatarForm.append('userId', userAId);
      const legacyAvatar = await requestForm(
        jarA,
        '/api/internal/storage/avatar',
        'POST',
        legacyAvatarForm
      );
      assertStatus(legacyAvatar.response, 410, 'avatar legacy relay disabled');

      const legacyContentForm = new FormData();
      legacyContentForm.append('file', createImageBlob(), 'legacy-content.png');
      legacyContentForm.append('userId', userAId);
      const legacyContent = await requestForm(
        jarA,
        '/api/internal/storage/content-images',
        'POST',
        legacyContentForm
      );
      assertStatus(
        legacyContent.response,
        410,
        'content-images legacy relay disabled'
      );

      legacyAvatarRelayDisabled = true;
      legacyContentRelayDisabled = true;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: {
            avatarPresignUploadCommit: true,
            avatarPresignDownload: true,
            avatarOwnershipGuards: true,
            contentPresignUploadListDelete: true,
            contentPresignDownload: true,
            contentOwnershipGuards: true,
            legacyAvatarFallback,
            legacyContentFallback,
            legacyAvatarRelayDisabled,
            legacyContentRelayDisabled,
          },
          artifacts: {
            avatarPath: userAAvatarPath,
            contentImagePath: userAContentImagePath,
            contentImagePublicUrl: contentPublicUrl,
          },
        },
        null,
        2
      )
    );
  } catch (error) {
    exitCode = 1;
    console.error(
      '[m5-storage-e2e] failed:',
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    await terminateProcess(appProc);
    await dbClient.end().catch(() => {});
    process.exit(exitCode);
  }
}

main();
