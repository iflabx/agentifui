import {
  getSessionCacheSnapshot,
  getSessionCacheTtlMs,
  getSessionStaleGraceMs,
  getSessionThrottleBackoffMs,
  setSessionBackoffUntil,
  setSessionCacheResolved,
  setSessionInflight,
  subscribeAuthStateChange,
} from './cache';
import { asString, getInternalProfileStatus, isUuid } from './helpers';
import type { BetterAuthSession, BetterAuthUser } from './types';

async function fetchCurrentSessionUncached(): Promise<BetterAuthSession | null> {
  const response = await fetch('/api/auth/better/get-session', {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to get session (${response.status})`);
  }

  const payload = (await response
    .json()
    .catch(() => null)) as BetterAuthSession;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const sessionUser = payload.user;
  const authUserId = asString(sessionUser?.id);

  if (!sessionUser || !authUserId) {
    return null;
  }

  if (isUuid(authUserId)) {
    return payload;
  }

  const profileStatus = await getInternalProfileStatus();
  const internalUserId = asString(profileStatus?.userId);
  const resolvedAuthUserId = asString(profileStatus?.authUserId) || authUserId;

  if (!internalUserId) {
    throw new Error('Failed to resolve internal UUID for current session user');
  }

  const patchedSession: BetterAuthSession = {
    ...payload,
    session: payload.session
      ? {
          ...payload.session,
          userId: internalUserId,
          authUserId: resolvedAuthUserId,
        }
      : payload.session,
    user: {
      ...sessionUser,
      id: internalUserId,
      auth_user_id: resolvedAuthUserId,
      role:
        typeof profileStatus?.role === 'string'
          ? profileStatus.role
          : sessionUser.role,
      status:
        typeof profileStatus?.status === 'string'
          ? profileStatus.status
          : sessionUser.status,
    },
  };

  return patchedSession;
}

function isRateLimitSessionError(error: unknown): boolean {
  return error instanceof Error && /\(429\)/.test(error.message);
}

export async function getCurrentSession(options?: {
  forceRefresh?: boolean;
}): Promise<BetterAuthSession | null> {
  const now = Date.now();
  const forceRefresh = options?.forceRefresh === true;
  const cacheTtlMs = getSessionCacheTtlMs();
  const staleGraceMs = getSessionStaleGraceMs();
  const cache = getSessionCacheSnapshot();

  if (
    !forceRefresh &&
    cache.cachedAt > 0 &&
    now - cache.cachedAt <= cacheTtlMs
  ) {
    return cache.value;
  }

  if (!forceRefresh && now < cache.backoffUntil) {
    if (cache.cachedAt > 0 && now - cache.cachedAt <= staleGraceMs) {
      return cache.value;
    }
    return null;
  }

  if (!forceRefresh && cache.inflight) {
    return cache.inflight;
  }

  const requestPromise = (async () => {
    try {
      const session = await fetchCurrentSessionUncached();
      setSessionCacheResolved(session);
      return session;
    } catch (error) {
      if (isRateLimitSessionError(error)) {
        setSessionBackoffUntil(Date.now() + getSessionThrottleBackoffMs());
        const current = getSessionCacheSnapshot();
        if (
          current.cachedAt > 0 &&
          Date.now() - current.cachedAt <= staleGraceMs
        ) {
          return current.value;
        }
        return null;
      }
      throw error;
    } finally {
      setSessionInflight(null);
    }
  })();

  setSessionInflight(requestPromise);
  return requestPromise;
}

export async function getCurrentUser(): Promise<BetterAuthUser | null> {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

export { subscribeAuthStateChange };
