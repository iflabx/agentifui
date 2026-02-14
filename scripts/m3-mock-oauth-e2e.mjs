#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const appPort = Number(process.env.MOCK_OAUTH_APP_PORT || 3101);
const oauthPort = Number(process.env.MOCK_OAUTH_PORT || 3901);
const appBase = `http://127.0.0.1:${appPort}`;
const oauthBase = `http://127.0.0.1:${oauthPort}`;
const fallbackDatabaseUrl =
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui';
const fallbackRedisUrl = 'redis://172.20.0.1:6379/0';
const fallbackS3Endpoint = 'http://172.20.0.1:9000';

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  updateFromResponse(response) {
    const headers = response.headers;
    const setCookies =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [];

    for (const line of setCookies) {
      const [pair, ...attrs] = line.split(';');
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) continue;

      const name = pair.slice(0, eqIndex).trim();
      const value = pair.slice(eqIndex + 1).trim();
      if (!name) continue;

      const maxAgeAttr = attrs.find(attr =>
        attr.trim().toLowerCase().startsWith('max-age=')
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
    if (this.cookies.size === 0) return '';
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

async function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
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
  throw new Error(`Server not ready: ${url}`);
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

async function main() {
  const oauthProc = startProcess(
    'node',
    ['scripts/mock-oauth-provider.mjs'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MOCK_OAUTH_PORT: String(oauthPort),
        MOCK_OAUTH_HOST: '127.0.0.1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const genericProviders = [
    {
      providerId: 'github',
      authorizationUrl: `${oauthBase}/oauth/authorize`,
      tokenUrl: `${oauthBase}/oauth/token`,
      userInfoUrl: `${oauthBase}/oauth/userinfo`,
      clientId: 'mock-github-client',
      clientSecret: 'mock-github-secret',
      scopes: ['read:user', 'user:email'],
    },
  ];

  const appProc = startProcess(
    'pnpm',
    ['next', 'dev', '-p', String(appPort)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NEXT_PUBLIC_APP_URL: appBase,
        BETTER_AUTH_URL: appBase,
        BETTER_AUTH_SECRET:
          process.env.BETTER_AUTH_SECRET ||
          'mock-oauth-e2e-secret-not-for-production',
        BETTER_AUTH_GENERIC_OAUTH_PROVIDERS_JSON: JSON.stringify(
          genericProviders
        ),
        DATABASE_URL:
          process.env.DATABASE_URL ||
          process.env.MOCK_OAUTH_DATABASE_URL ||
          fallbackDatabaseUrl,
        REDIS_URL:
          process.env.REDIS_URL ||
          process.env.MOCK_OAUTH_REDIS_URL ||
          fallbackRedisUrl,
        S3_ENDPOINT:
          process.env.S3_ENDPOINT ||
          process.env.MOCK_OAUTH_S3_ENDPOINT ||
          fallbackS3Endpoint,
        S3_ACCESS_KEY_ID:
          process.env.S3_ACCESS_KEY_ID ||
          process.env.MOCK_OAUTH_S3_ACCESS_KEY_ID ||
          'minioadmin',
        S3_SECRET_ACCESS_KEY:
          process.env.S3_SECRET_ACCESS_KEY ||
          process.env.MOCK_OAUTH_S3_SECRET_ACCESS_KEY ||
          'minioadmin',
        S3_BUCKET:
          process.env.S3_BUCKET || process.env.MOCK_OAUTH_S3_BUCKET || 'agentifui',
        S3_ENABLE_PATH_STYLE:
          process.env.S3_ENABLE_PATH_STYLE ||
          process.env.MOCK_OAUTH_S3_ENABLE_PATH_STYLE ||
          '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const stopAll = async exitCode => {
    oauthProc.kill('SIGTERM');
    appProc.kill('SIGTERM');
    await sleep(800);
    process.exit(exitCode);
  };

  try {
    await waitForServer(`${oauthBase}/oauth/authorize`);
    await waitForServer(`${appBase}/api/auth/better/get-session`);

    const jar = new CookieJar();

    const signInResponse = await requestWithCookies(
      jar,
      `${appBase}/api/auth/better/sign-in/oauth2`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: appBase,
          referer: `${appBase}/`,
        },
        body: JSON.stringify({
          providerId: 'github',
          callbackURL: '/api/auth/better/get-session',
          disableRedirect: true,
        }),
      }
    );
    if (!signInResponse.ok) {
      throw new Error(`sign-in/oauth2 failed: ${signInResponse.status}`);
    }

    const signInPayload = await signInResponse.json();
    if (!signInPayload?.url) {
      throw new Error('sign-in/oauth2 did not return oauth url');
    }

    const authorizeResponse = await requestWithCookies(jar, signInPayload.url, {
      method: 'GET',
    });
    const callbackUrl = authorizeResponse.headers.get('location');
    if (authorizeResponse.status !== 302 || !callbackUrl) {
      throw new Error(
        `mock authorize did not redirect correctly (${authorizeResponse.status})`
      );
    }

    const callbackResponse = await requestWithCookies(jar, callbackUrl, {
      method: 'GET',
    });
    if (callbackResponse.status !== 302) {
      throw new Error(`oauth callback failed: ${callbackResponse.status}`);
    }

    const sessionResponse = await requestWithCookies(
      jar,
      `${appBase}/api/auth/better/get-session`,
      {
        method: 'GET',
      }
    );
    if (!sessionResponse.ok) {
      throw new Error(
        `get-session failed after oauth login: ${sessionResponse.status}`
      );
    }

    const sessionPayload = await sessionResponse.json();
    const userId = sessionPayload?.user?.id;
    if (!userId) {
      throw new Error('oauth login did not create an authenticated session');
    }

    const signOutResponse = await requestWithCookies(
      jar,
      `${appBase}/api/auth/better/sign-out`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: appBase,
          referer: `${appBase}/`,
        },
        body: JSON.stringify({}),
      }
    );
    if (!signOutResponse.ok) {
      throw new Error(`sign-out failed: ${signOutResponse.status}`);
    }

    const postSignOutSession = await requestWithCookies(
      jar,
      `${appBase}/api/auth/better/get-session`,
      {
        method: 'GET',
      }
    );
    const postSignOutPayload = await postSignOutSession
      .json()
      .catch(() => null);
    const isSignedOut =
      postSignOutSession.status === 401 || !postSignOutPayload?.user?.id;

    console.log(
      JSON.stringify(
        {
          ok: true,
          oauthProvider: 'github(mock)',
          signedInUserId: userId,
          signOutVerified: isSignedOut,
        },
        null,
        2
      )
    );

    await stopAll(0);
  } catch (error) {
    console.error(
      '[mock-oauth-e2e] failed:',
      error instanceof Error ? error.message : String(error)
    );
    await stopAll(1);
  }
}

main();
