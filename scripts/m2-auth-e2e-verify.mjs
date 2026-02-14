#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';
import { createClient as createRedisClient } from 'redis';

loadEnv({ path: '.env.test-stack' });

const appPort = Number(process.env.M2_AUTH_APP_PORT || 3312);
const appBase = `http://127.0.0.1:${appPort}`;
const appReadyTimeoutMs = Number(process.env.M2_AUTH_READY_TIMEOUT_MS || 120000);
const sessionExpiresInSeconds = Number(
  process.env.M2_AUTH_SESSION_EXPIRES_IN_SECONDS || 6
);
const postExpiryWaitMs = Math.max(4000, (sessionExpiresInSeconds + 2) * 1000);

const fallbackDatabaseUrl =
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui';
const fallbackRedisUrl = 'redis://172.20.0.1:6379/0';
const fallbackS3Endpoint = 'http://172.20.0.1:9000';

function assertStatus(response, allowedStatuses, label) {
  if (allowedStatuses.includes(response.status)) {
    return;
  }

  throw new Error(
    `${label} returned ${response.status}, expected ${allowedStatuses.join(' or ')}`
  );
}

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
  return {
    response,
    payload,
  };
}

async function verifySessionTokenStoredInRedis(token, redisUrl, redisPrefix) {
  const client = createRedisClient({ url: redisUrl });
  client.on('error', () => {});

  await client.connect();
  try {
    const key = `${redisPrefix}:better-auth:secondary:${token}`;
    const value = await client.get(key);
    if (!value) {
      throw new Error(
        `redis session key not found for token (key=${key.slice(0, 40)}...)`
      );
    }
  } finally {
    await client.quit();
  }
}

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    process.env.M2_AUTH_DATABASE_URL?.trim() ||
    fallbackDatabaseUrl;
  const redisUrl =
    process.env.REDIS_URL?.trim() ||
    process.env.M2_AUTH_REDIS_URL?.trim() ||
    fallbackRedisUrl;
  const redisPrefix = process.env.REDIS_PREFIX?.trim() || 'agentifui';
  const s3Endpoint =
    process.env.S3_ENDPOINT?.trim() ||
    process.env.M2_AUTH_S3_ENDPOINT?.trim() ||
    fallbackS3Endpoint;

  const appProc = startProcess('pnpm', ['next', 'dev', '-p', String(appPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      AUTH_BACKEND: process.env.AUTH_BACKEND || 'better-auth',
      NEXT_PUBLIC_APP_URL: appBase,
      BETTER_AUTH_URL: appBase,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET || 'm2-auth-e2e-secret-not-for-production',
      BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS: String(sessionExpiresInSeconds),
      BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS: '0',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      REDIS_PREFIX: redisPrefix,
      S3_ENDPOINT: s3Endpoint,
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || 'minioadmin',
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
      S3_BUCKET: process.env.S3_BUCKET || 'agentifui',
      S3_ENABLE_PATH_STYLE: process.env.S3_ENABLE_PATH_STYLE || '1',
      AUTH_RESET_PASSWORD_MODE: process.env.AUTH_RESET_PASSWORD_MODE || 'dev-log',
      AUTH_PHONE_OTP_ENABLED: process.env.AUTH_PHONE_OTP_ENABLED || '1',
      AUTH_PHONE_OTP_MODE: process.env.AUTH_PHONE_OTP_MODE || 'dev-log',
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

  try {
    await waitForServer(`${appBase}/api/auth/better/get-session`, appReadyTimeoutMs);

    const jar = new CookieJar();
    const suffix = randomSuffix();
    const email = `m2-e2e-${suffix}@example.com`;
    const password = `M2Test!${suffix}`;
    const name = `M2 E2E ${suffix}`;

    const signUp = await requestJson(jar, '/api/auth/better/sign-up/email', 'POST', {
      name,
      email,
      password,
      callbackURL: '/chat/new',
    });
    assertStatus(signUp.response, [200], 'sign-up/email');

    const sessionAfterSignUp = await requestWithCookies(
      jar,
      `${appBase}/api/auth/better/get-session`,
      {
        method: 'GET',
      }
    );
    assertStatus(sessionAfterSignUp, [200], 'get-session after sign-up');
    const sessionAfterSignUpPayload = await sessionAfterSignUp
      .json()
      .catch(() => null);
    if (!sessionAfterSignUpPayload?.user?.id) {
      throw new Error('session user is missing right after sign-up');
    }

    const signOut = await requestJson(jar, '/api/auth/better/sign-out', 'POST', {});
    assertStatus(signOut.response, [200], 'sign-out');

    const signIn = await requestJson(jar, '/api/auth/better/sign-in/email', 'POST', {
      email,
      password,
      callbackURL: '/chat/new',
    });
    assertStatus(signIn.response, [200], 'sign-in/email');
    const sessionToken =
      typeof signIn.payload?.token === 'string' ? signIn.payload.token : null;
    if (!sessionToken) {
      throw new Error('sign-in/email did not return session token');
    }

    await verifySessionTokenStoredInRedis(sessionToken, redisUrl, redisPrefix);

    const sessionAfterSignIn = await requestWithCookies(
      jar,
      `${appBase}/api/auth/better/get-session`,
      {
        method: 'GET',
      }
    );
    assertStatus(sessionAfterSignIn, [200], 'get-session after sign-in');

    await sleep(postExpiryWaitMs);

    const sessionAfterExpiry = await requestWithCookies(
      jar,
      `${appBase}/api/auth/better/get-session`,
      {
        method: 'GET',
      }
    );
    const sessionAfterExpiryPayload = await sessionAfterExpiry
      .json()
      .catch(() => null);
    const sessionExpired =
      sessionAfterExpiry.status === 401 || !sessionAfterExpiryPayload?.user?.id;
    if (!sessionExpired) {
      throw new Error('session was expected to expire but still valid');
    }

    const requestReset = await requestJson(
      jar,
      '/api/auth/better/request-password-reset',
      'POST',
      {
        email,
        redirectTo: `${appBase}/reset-password`,
      }
    );
    assertStatus(requestReset.response, [200], 'request-password-reset');

    const sendOtp = await requestJson(
      jar,
      '/api/auth/better/phone-number/send-otp',
      'POST',
      {
        phoneNumber: '+8613800138000',
      }
    );
    assertStatus(sendOtp.response, [200], 'phone-number/send-otp');

    const verifyOtp = await requestJson(
      jar,
      '/api/auth/better/phone-number/verify',
      'POST',
      {
        phoneNumber: '+8613800138000',
        code: '000000',
        disableSession: true,
      }
    );

    if (verifyOtp.response.status === 404) {
      throw new Error('phone-number/verify endpoint returned 404');
    }
    assertStatus(verifyOtp.response, [400, 401, 403, 429], 'phone-number/verify');

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: {
            signUp: true,
            signIn: true,
            redisSecondaryStorage: true,
            sessionExpiry: true,
            passwordResetRoute: true,
            phoneOtpRoutes: true,
          },
          authUserId: sessionAfterSignUpPayload.user.id,
          email,
        },
        null,
        2
      )
    );

    await stopAll(0);
  } catch (error) {
    console.error(
      '[m2-auth-e2e] failed:',
      error instanceof Error ? error.message : String(error)
    );
    await stopAll(1);
  }
}

main();
