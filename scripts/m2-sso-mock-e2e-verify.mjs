#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

loadEnv({ path: '.env.test-stack' });

const appPort = Number(process.env.M2_SSO_APP_PORT || 3313);
const oauthPort = Number(process.env.M2_SSO_OAUTH_PORT || 3902);
const appBase = `http://127.0.0.1:${appPort}`;
const oauthBase = `http://127.0.0.1:${oauthPort}`;
const appReadyTimeoutMs = Number(process.env.M2_SSO_READY_TIMEOUT_MS || 120000);

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

function toAbsoluteUrl(location, baseUrl) {
  if (!location) {
    return null;
  }

  try {
    return new URL(location, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizeAuthErrorCode(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase().replace(/\s+/g, '_');
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

async function runCommand(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    proc.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(' ')} exited with code ${code}\n${stderr || stdout}`
        )
      );
    });
  });
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

async function followSsoSignIn({
  jar,
  providerId,
  callbackURL,
  errorCallbackURL,
  loginHint,
}) {
  const signIn = await requestJson(
    jar,
    '/api/auth/better/sign-in/sso',
    'POST',
    {
      providerId,
      callbackURL,
      errorCallbackURL,
      loginHint,
    }
  );
  assertStatus(signIn.response, [200], 'sign-in/sso');

  const authorizationUrl =
    typeof signIn.payload?.url === 'string' ? signIn.payload.url : null;
  if (!authorizationUrl) {
    throw new Error('sign-in/sso did not return authorization url');
  }

  const authorizeResponse = await requestWithCookies(jar, authorizationUrl, {
    method: 'GET',
  });
  assertStatus(authorizeResponse, [302], 'mock oidc authorize redirect');

  const callbackUrl = toAbsoluteUrl(
    authorizeResponse.headers.get('location'),
    oauthBase
  );
  if (!callbackUrl) {
    throw new Error('authorize redirect location is missing');
  }

  const callbackResponse = await requestWithCookies(jar, callbackUrl, {
    method: 'GET',
  });
  assertStatus(callbackResponse, [302], 'sso callback redirect');

  return callbackResponse.headers.get('location');
}

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    process.env.M2_SSO_DATABASE_URL?.trim() ||
    fallbackDatabaseUrl;
  const redisUrl =
    process.env.REDIS_URL?.trim() ||
    process.env.M2_SSO_REDIS_URL?.trim() ||
    fallbackRedisUrl;
  const s3Endpoint =
    process.env.S3_ENDPOINT?.trim() ||
    process.env.M2_SSO_S3_ENDPOINT?.trim() ||
    fallbackS3Endpoint;
  const providerId = process.env.M2_SSO_PROVIDER_ID?.trim() || 'mock-oidc';
  const providerDomain =
    process.env.M2_SSO_PROVIDER_DOMAIN?.trim() || 'example.com';
  const providerClientId =
    process.env.M2_SSO_PROVIDER_CLIENT_ID?.trim() || 'mock-oidc-client';
  const providerClientSecret =
    process.env.M2_SSO_PROVIDER_CLIENT_SECRET?.trim() || 'mock-oidc-secret';

  const ssoProviders = [
    {
      providerId,
      domain: providerDomain,
      issuer: oauthBase,
      discoveryEndpoint: `${oauthBase}/.well-known/openid-configuration`,
      clientId: providerClientId,
      clientSecret: providerClientSecret,
      mode: 'native',
      displayName: 'Mock OIDC',
    },
  ];

  const oauthProc = startProcess('node', ['scripts/mock-oauth-provider.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MOCK_OAUTH_PORT: String(oauthPort),
      MOCK_OAUTH_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const appProc = startProcess('pnpm', ['next', 'dev', '-p', String(appPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      AUTH_BACKEND: process.env.AUTH_BACKEND || 'better-auth',
      NEXT_PUBLIC_APP_URL: appBase,
      BETTER_AUTH_URL: appBase,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ||
        'm2-sso-mock-e2e-secret-not-for-production',
      BETTER_AUTH_SSO_PROVIDERS_JSON: JSON.stringify(ssoProviders),
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      S3_ENDPOINT: s3Endpoint,
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || 'minioadmin',
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
      S3_BUCKET: process.env.S3_BUCKET || 'agentifui',
      S3_ENABLE_PATH_STYLE: process.env.S3_ENABLE_PATH_STYLE || '1',
      AUTH_RESET_PASSWORD_MODE:
        process.env.AUTH_RESET_PASSWORD_MODE || 'dev-log',
      AUTH_PHONE_OTP_ENABLED: process.env.AUTH_PHONE_OTP_ENABLED || '1',
      AUTH_PHONE_OTP_MODE: process.env.AUTH_PHONE_OTP_MODE || 'dev-log',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stopAll = async exitCode => {
    if (!oauthProc.killed && oauthProc.exitCode === null) {
      oauthProc.kill('SIGTERM');
      await sleep(500);
      if (oauthProc.exitCode === null) {
        oauthProc.kill('SIGKILL');
      }
    }

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
    await waitForServer(`${oauthBase}/.well-known/openid-configuration`, 30000);
    await waitForServer(
      `${appBase}/api/auth/better/get-session`,
      appReadyTimeoutMs
    );

    await runCommand('node', ['scripts/m2-oidc-discovery-verify.mjs'], {
      env: {
        ...process.env,
        BETTER_AUTH_SSO_PROVIDERS_JSON: JSON.stringify(ssoProviders),
        OIDC_VERIFY_REQUIRE_PROVIDERS: '1',
      },
    });

    const jar = new CookieJar();
    const suffix = randomSuffix();

    const successEmail = `m2-sso-ok-${suffix}@${providerDomain}`;
    const successRedirect = await followSsoSignIn({
      jar,
      providerId,
      callbackURL: '/chat/new',
      errorCallbackURL: '/auth/error',
      loginHint: successEmail,
    });
    if (!successRedirect || successRedirect.includes('error=')) {
      throw new Error(
        `SSO happy-path returned unexpected redirect: ${successRedirect || 'empty'}`
      );
    }

    const sessionAfterSso = await requestWithCookies(
      jar,
      `${appBase}/api/auth/better/get-session`,
      {
        method: 'GET',
      }
    );
    assertStatus(sessionAfterSso, [200], 'get-session after successful sso');
    const sessionAfterSsoPayload = await sessionAfterSso
      .json()
      .catch(() => null);
    const happyPathUserId = sessionAfterSsoPayload?.user?.id;
    if (!happyPathUserId) {
      throw new Error('SSO happy-path did not create an authenticated session');
    }

    const signOutAfterSso = await requestJson(
      jar,
      '/api/auth/better/sign-out',
      'POST',
      {}
    );
    assertStatus(signOutAfterSso.response, [200], 'sign-out after sso');

    const conflictEmail = `m2-sso-conflict-${suffix}@${providerDomain}`;
    const conflictPassword = `M2Sso!${suffix}`;

    const signUpConflictSeed = await requestJson(
      jar,
      '/api/auth/better/sign-up/email',
      'POST',
      {
        name: `M2 SSO Conflict ${suffix}`,
        email: conflictEmail,
        password: conflictPassword,
        callbackURL: '/chat/new',
      }
    );
    assertStatus(
      signUpConflictSeed.response,
      [200],
      'sign-up/email conflict seed'
    );

    const signOutConflictSeed = await requestJson(
      jar,
      '/api/auth/better/sign-out',
      'POST',
      {}
    );
    assertStatus(signOutConflictSeed.response, [200], 'sign-out conflict seed');

    const conflictRedirect = await followSsoSignIn({
      jar,
      providerId,
      callbackURL: '/chat/new',
      errorCallbackURL: '/auth/error',
      loginHint: conflictEmail,
    });
    const conflictRedirectUrl = toAbsoluteUrl(conflictRedirect, appBase);
    const conflictErrorCode = conflictRedirectUrl
      ? normalizeAuthErrorCode(
          new URL(conflictRedirectUrl).searchParams.get('error') || ''
        )
      : '';
    if (
      !conflictRedirect ||
      !conflictRedirect.includes('/auth/error') ||
      conflictErrorCode !== 'account_not_linked'
    ) {
      throw new Error(
        `SSO conflict-path should be rejected with account_not_linked, got: ${conflictRedirect || 'empty'}`
      );
    }

    const sessionAfterConflict = await requestWithCookies(
      jar,
      `${appBase}/api/auth/better/get-session`,
      {
        method: 'GET',
      }
    );
    const sessionAfterConflictPayload = await sessionAfterConflict
      .json()
      .catch(() => null);
    const conflictHasSession =
      sessionAfterConflict.status === 200 &&
      Boolean(sessionAfterConflictPayload?.user?.id);
    if (conflictHasSession) {
      throw new Error(
        'SSO conflict-path should not result in an authenticated session'
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: {
            oidcDiscoveryRequireProviders: true,
            ssoHappyPath: true,
            ssoConflictRejected: true,
          },
          providerId,
          happyPathUserId,
          conflictEmail,
        },
        null,
        2
      )
    );

    await stopAll(0);
  } catch (error) {
    console.error(
      '[m2-sso-mock-e2e] failed:',
      error instanceof Error ? error.message : String(error)
    );
    await stopAll(1);
  }
}

main();
