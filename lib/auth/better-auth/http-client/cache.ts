import type { BetterAuthSession } from './types';

const AUTH_STATE_CHANGE_EVENT = 'agentifui:auth-state-changed';
const DEFAULT_SESSION_CACHE_TTL_MS = 5000;
const DEFAULT_SESSION_THROTTLE_BACKOFF_MS = 2000;
const DEFAULT_SESSION_STALE_GRACE_MS = 60_000;

let sessionCacheValue: BetterAuthSession | null = null;
let sessionCacheAt = 0;
let sessionInflight: Promise<BetterAuthSession | null> | null = null;
let sessionBackoffUntil = 0;

function parsePositiveIntEnv(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function getSessionCacheTtlMs(): number {
  return parsePositiveIntEnv(
    process.env.NEXT_PUBLIC_AUTH_SESSION_CACHE_TTL_MS,
    DEFAULT_SESSION_CACHE_TTL_MS
  );
}

export function getSessionThrottleBackoffMs(): number {
  return parsePositiveIntEnv(
    process.env.NEXT_PUBLIC_AUTH_SESSION_THROTTLE_BACKOFF_MS,
    DEFAULT_SESSION_THROTTLE_BACKOFF_MS
  );
}

export function getSessionStaleGraceMs(): number {
  return parsePositiveIntEnv(
    process.env.NEXT_PUBLIC_AUTH_SESSION_STALE_GRACE_MS,
    DEFAULT_SESSION_STALE_GRACE_MS
  );
}

export function clearSessionCache(): void {
  sessionCacheValue = null;
  sessionCacheAt = 0;
  sessionInflight = null;
  sessionBackoffUntil = 0;
}

export function emitAuthStateChanged(): void {
  clearSessionCache();

  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
}

export function subscribeAuthStateChange(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = () => listener();
  window.addEventListener(AUTH_STATE_CHANGE_EVENT, handler);
  window.addEventListener('focus', handler);

  return () => {
    window.removeEventListener(AUTH_STATE_CHANGE_EVENT, handler);
    window.removeEventListener('focus', handler);
  };
}

export function getSessionCacheSnapshot(): {
  value: BetterAuthSession | null;
  cachedAt: number;
  inflight: Promise<BetterAuthSession | null> | null;
  backoffUntil: number;
} {
  return {
    value: sessionCacheValue,
    cachedAt: sessionCacheAt,
    inflight: sessionInflight,
    backoffUntil: sessionBackoffUntil,
  };
}

export function setSessionCacheResolved(value: BetterAuthSession | null): void {
  sessionCacheValue = value;
  sessionCacheAt = Date.now();
  sessionBackoffUntil = 0;
}

export function setSessionInflight(
  inflight: Promise<BetterAuthSession | null> | null
): void {
  sessionInflight = inflight;
}

export function setSessionBackoffUntil(value: number): void {
  sessionBackoffUntil = value;
}
