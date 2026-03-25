import { syncSessionIdentitySideEffects } from '@lib/auth/better-auth/session-identity';

import { mergeCookieHeader, readSetCookies } from './cookies';

const DEFAULT_SYNC_RETRY_ATTEMPTS = 3;
const DEFAULT_SYNC_RETRY_DELAY_MS = 250;
const MAX_SYNC_RETRY_ATTEMPTS = 6;
const MAX_SYNC_RETRY_DELAY_MS = 5000;

function parseBoundedPositiveInt(
  value: string | undefined,
  fallback: number,
  maxValue: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(maxValue, Math.floor(parsed)));
}

function getSyncRetryAttempts(): number {
  return parseBoundedPositiveInt(
    process.env.AUTH_IDENTITY_SYNC_RETRY_ATTEMPTS,
    DEFAULT_SYNC_RETRY_ATTEMPTS,
    MAX_SYNC_RETRY_ATTEMPTS
  );
}

function getSyncRetryDelayMs(): number {
  return parseBoundedPositiveInt(
    process.env.AUTH_IDENTITY_SYNC_RETRY_DELAY_MS,
    DEFAULT_SYNC_RETRY_DELAY_MS,
    MAX_SYNC_RETRY_DELAY_MS
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function runPostAuthIdentitySyncWithRetry(
  headers: Headers
): Promise<{ ok: true; attempts: number } | { ok: false; attempts: number }> {
  const maxAttempts = getSyncRetryAttempts();
  const retryDelayMs = getSyncRetryDelayMs();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await syncSessionIdentitySideEffects(headers);
    if (result.success) {
      return { ok: true, attempts: attempt };
    }

    if (attempt >= maxAttempts) {
      console.warn('[AuthIdentitySync] post-login identity sync failed:', {
        attempt,
        error: result.error,
      });
      return { ok: false, attempts: attempt };
    }

    console.warn('[AuthIdentitySync] retrying post-login identity sync:', {
      attempt,
      error: result.error,
    });
    await delay(retryDelayMs * attempt);
  }

  return { ok: false, attempts: maxAttempts };
}

function shouldTriggerAuthIdentitySync(
  request: Request,
  response: Response,
  setCookies: string[]
): boolean {
  if (setCookies.length === 0) {
    return false;
  }
  if (response.status < 200 || response.status >= 400) {
    return false;
  }

  const { pathname } = new URL(request.url);
  return (
    pathname.includes('/sign-in/') ||
    pathname.includes('/sign-up/') ||
    pathname.includes('/callback/')
  );
}

export async function syncPostAuthIdentityIfNeeded(
  request: Request,
  response: Response
): Promise<void> {
  const setCookies = readSetCookies(response.headers);
  if (!shouldTriggerAuthIdentitySync(request, response, setCookies)) {
    return;
  }

  const mergedCookieHeader = mergeCookieHeader(
    request.headers.get('cookie'),
    setCookies
  );
  const syncHeaders = new Headers(request.headers);
  if (mergedCookieHeader) {
    syncHeaders.set('cookie', mergedCookieHeader);
  }

  try {
    const syncResult = await runPostAuthIdentitySyncWithRetry(syncHeaders);
    if (syncResult.ok) {
      return;
    }

    console.warn(
      '[AuthIdentitySync] post-login identity sync exhausted retries:',
      {
        attempts: syncResult.attempts,
      }
    );
  } catch (error) {
    console.warn(
      '[AuthIdentitySync] unexpected post-login identity sync error:',
      error
    );
  }
}
