#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

loadEnv({ path: '.env.test-stack' });

const appPort = Number(process.env.M2_SLO_APP_PORT || 3314);
const oauthPort = Number(process.env.M2_SLO_OAUTH_PORT || 3903);
const appBase = `http://127.0.0.1:${appPort}`;
const oauthBase = `http://127.0.0.1:${oauthPort}`;
const appReadyTimeoutMs = Number(process.env.M2_SLO_READY_TIMEOUT_MS || 120000);
const requestCount = Number(process.env.M2_SLO_REQUEST_COUNT || 20);
const concurrency = Number(process.env.M2_SLO_CONCURRENCY || 1);
const caseWarmupCount = Number(process.env.M2_SLO_CASE_WARMUP_COUNT || 2);
const reportPath =
  process.env.M2_SLO_REPORT_PATH || 'docs/m2-auth-slo-baseline.md';

const thresholds = {
  p95Ms: Number(process.env.M2_SLO_P95_MS || 300),
  p99Ms: Number(process.env.M2_SLO_P99_MS || 800),
  fiveXxRatePercent: Number(process.env.M2_SLO_5XX_RATE_PERCENT || 0.3),
};

const fallbackDatabaseUrl =
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui';
const fallbackRedisUrl = 'redis://172.20.0.1:6379/0';
const fallbackS3Endpoint = 'http://172.20.0.1:9000';

function randomSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function formatMs(value) {
  return Number(value).toFixed(2);
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.max(0, Math.min(sorted.length - 1, rank));
  return sorted[index];
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

function statusCountToText(statusCount) {
  return Array.from(statusCount.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([status, count]) => `${status}:${count}`)
    .join(', ');
}

function evaluateResult(result) {
  return (
    result.p95Ms <= thresholds.p95Ms &&
    result.p99Ms <= thresholds.p99Ms &&
    result.fiveXxRatePercent < thresholds.fiveXxRatePercent
  );
}

async function runLoadCase(name, executeRequest) {
  for (let index = 0; index < Math.max(0, caseWarmupCount); index += 1) {
    try {
      await executeRequest();
    } catch {}
  }

  const durations = [];
  const statusCount = new Map();
  let networkErrorCount = 0;
  let cursor = 0;

  async function worker() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= requestCount) {
        return;
      }

      const startedAt = performance.now();
      try {
        const response = await executeRequest();
        const elapsed = performance.now() - startedAt;
        durations.push(elapsed);
        statusCount.set(
          response.status,
          (statusCount.get(response.status) || 0) + 1
        );
      } catch {
        const elapsed = performance.now() - startedAt;
        durations.push(elapsed);
        networkErrorCount += 1;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker())
  );

  const totalCount = durations.length;
  const fiveXxCount =
    Array.from(statusCount.entries())
      .filter(([status]) => status >= 500 && status <= 599)
      .reduce((sum, [, count]) => sum + count, 0) + networkErrorCount;

  return {
    name,
    totalCount,
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxMs: Math.max(...durations, 0),
    fiveXxRatePercent: totalCount > 0 ? (fiveXxCount / totalCount) * 100 : 0,
    networkErrorCount,
    statusCount,
  };
}

function buildMarkdownReport(results, startedAt, endedAt) {
  const lines = [];
  lines.push('# M2 Auth SLO Baseline Report');
  lines.push('');
  lines.push(`- Generated At: ${endedAt}`);
  lines.push(`- Started At: ${startedAt}`);
  lines.push(`- App Base: ${appBase}`);
  lines.push(`- Request Count (per case): ${requestCount}`);
  lines.push(`- Concurrency: ${concurrency}`);
  lines.push(`- Warm-up Count (per case, excluded): ${caseWarmupCount}`);
  lines.push('');
  lines.push('## Thresholds');
  lines.push('');
  lines.push(`- p95 <= ${thresholds.p95Ms}ms`);
  lines.push(`- p99 <= ${thresholds.p99Ms}ms`);
  lines.push(`- 5xx rate < ${thresholds.fiveXxRatePercent}%`);
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push(
    '| Case | p95(ms) | p99(ms) | max(ms) | 5xx rate(%) | status distribution | Pass |'
  );
  lines.push('| --- | ---: | ---: | ---: | ---: | --- | --- |');

  for (const result of results) {
    lines.push(
      `| ${result.name} | ${formatMs(result.p95Ms)} | ${formatMs(result.p99Ms)} | ${formatMs(result.maxMs)} | ${formatMs(result.fiveXxRatePercent)} | ${statusCountToText(result.statusCount)}${result.networkErrorCount > 0 ? `, neterr:${result.networkErrorCount}` : ''} | ${evaluateResult(result) ? 'yes' : 'no'} |`
    );
  }

  lines.push('');
  return lines.join('\n');
}

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    process.env.M2_SLO_DATABASE_URL?.trim() ||
    fallbackDatabaseUrl;
  const redisUrl =
    process.env.REDIS_URL?.trim() ||
    process.env.M2_SLO_REDIS_URL?.trim() ||
    fallbackRedisUrl;
  const s3Endpoint =
    process.env.S3_ENDPOINT?.trim() ||
    process.env.M2_SLO_S3_ENDPOINT?.trim() ||
    fallbackS3Endpoint;
  const providerId = process.env.M2_SLO_PROVIDER_ID?.trim() || 'mock-slo-oidc';
  const providerDomain =
    process.env.M2_SLO_PROVIDER_DOMAIN?.trim() || 'example.com';
  const providerClientId =
    process.env.M2_SLO_PROVIDER_CLIENT_ID?.trim() || 'mock-slo-client';
  const providerClientSecret =
    process.env.M2_SLO_PROVIDER_CLIENT_SECRET?.trim() || 'mock-slo-secret';

  const ssoProviders = [
    {
      providerId,
      domain: providerDomain,
      issuer: oauthBase,
      discoveryEndpoint: `${oauthBase}/.well-known/openid-configuration`,
      clientId: providerClientId,
      clientSecret: providerClientSecret,
      mode: 'native',
      displayName: 'Mock SLO OIDC',
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
        'm2-auth-slo-secret-not-for-production',
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

  const startedAt = nowIso();

  try {
    await waitForServer(`${oauthBase}/.well-known/openid-configuration`, 30000);
    await waitForServer(
      `${appBase}/api/auth/better/get-session`,
      appReadyTimeoutMs
    );

    const suffix = randomSuffix();
    const email = `m2-slo-${suffix}@example.com`;
    const password = `M2Slo!${suffix}`;

    const seedJar = new CookieJar();
    const signUp = await requestJson(
      seedJar,
      '/api/auth/better/sign-up/email',
      'POST',
      {
        name: `M2 SLO ${suffix}`,
        email,
        password,
        callbackURL: '/chat/new',
      }
    );
    if (signUp.response.status !== 200) {
      throw new Error(
        `failed to seed benchmark user (${signUp.response.status})`
      );
    }

    await requestJson(seedJar, '/api/auth/better/sign-out', 'POST', {});

    const authJar = new CookieJar();
    const signIn = await requestJson(
      authJar,
      '/api/auth/better/sign-in/email',
      'POST',
      {
        email,
        password,
        callbackURL: '/chat/new',
      }
    );
    if (signIn.response.status !== 200) {
      throw new Error(
        `failed to seed authenticated cookie for get-session (${signIn.response.status})`
      );
    }

    // Warm-up requests to avoid counting first compile and JIT overhead.
    await requestJson(
      new CookieJar(),
      '/api/auth/better/sign-in/email',
      'POST',
      {
        email,
        password,
        callbackURL: '/chat/new',
      }
    );
    await requestWithCookies(
      authJar,
      `${appBase}/api/auth/better/get-session`,
      {
        method: 'GET',
      }
    );
    await requestJson(
      new CookieJar(),
      '/api/auth/better/request-password-reset',
      'POST',
      {
        email,
        redirectTo: `${appBase}/reset-password`,
      }
    );
    await requestJson(new CookieJar(), '/api/auth/better/sign-in/sso', 'POST', {
      providerId,
      callbackURL: '/chat/new',
      errorCallbackURL: '/login?error=sso_failed',
      loginHint: email,
    });
    await fetch(`${appBase}/api/sso/${providerId}/login?returnUrl=/chat/new`, {
      method: 'GET',
      redirect: 'manual',
    });

    const results = [];
    results.push(
      await runLoadCase('auth.get-session', async () => {
        return await requestWithCookies(
          authJar,
          `${appBase}/api/auth/better/get-session`,
          {
            method: 'GET',
          }
        );
      })
    );

    results.push(
      await runLoadCase('auth.request-password-reset', async () => {
        return await fetch(
          `${appBase}/api/auth/better/request-password-reset`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: appBase,
              referer: `${appBase}/`,
            },
            body: JSON.stringify({
              email,
              redirectTo: `${appBase}/reset-password`,
            }),
            redirect: 'manual',
          }
        );
      })
    );

    results.push(
      await runLoadCase('auth.sign-in.sso.start', async () => {
        return await fetch(`${appBase}/api/auth/better/sign-in/sso`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: appBase,
            referer: `${appBase}/`,
          },
          body: JSON.stringify({
            providerId,
            callbackURL: '/chat/new',
            errorCallbackURL: '/login?error=sso_failed',
            loginHint: email,
          }),
          redirect: 'manual',
        });
      })
    );

    results.push(
      await runLoadCase('legacy.sso.login.redirect', async () => {
        return await fetch(
          `${appBase}/api/sso/${providerId}/login?returnUrl=/chat/new`,
          {
            method: 'GET',
            redirect: 'manual',
          }
        );
      })
    );

    const endedAt = nowIso();
    const reportBody = buildMarkdownReport(results, startedAt, endedAt);
    await writeFile(reportPath, `${reportBody}\n`, 'utf8');

    const failedCases = results.filter(result => !evaluateResult(result));
    console.log(
      JSON.stringify(
        {
          ok: failedCases.length === 0,
          thresholds,
          requestCount,
          concurrency,
          reportPath,
          cases: results.map(result => ({
            name: result.name,
            p95Ms: Number(formatMs(result.p95Ms)),
            p99Ms: Number(formatMs(result.p99Ms)),
            maxMs: Number(formatMs(result.maxMs)),
            fiveXxRatePercent: Number(formatMs(result.fiveXxRatePercent)),
            statuses: statusCountToText(result.statusCount),
            networkErrorCount: result.networkErrorCount,
            pass: evaluateResult(result),
          })),
        },
        null,
        2
      )
    );

    if (failedCases.length > 0) {
      throw new Error(
        `SLO verification failed: ${failedCases.map(item => item.name).join(', ')}`
      );
    }

    await stopAll(0);
  } catch (error) {
    console.error(
      '[m2-auth-slo-verify] failed:',
      error instanceof Error ? error.message : String(error)
    );
    await stopAll(1);
  }
}

main();
