import type { FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from './pg-context';
import {
  INTERNAL_AUTH_ISSUER,
  bumpResolverMetric,
  extractCandidateSessionTokens,
  getSessionResolverMetricsSnapshot,
  normalizeRole,
  normalizeStatus,
  resetSessionResolverMetrics,
} from './session-identity/helpers';
import type {
  ResolveIdentityResult,
  ResolveProfileStatusResult,
  SessionIdentityRow,
} from './session-identity/types';

export type {
  ActorIdentity,
  ProfileStatusIdentity,
  SessionResolverMetrics,
} from './session-identity/types';
export { getSessionResolverMetricsSnapshot, resetSessionResolverMetrics };

const SESSION_RESOLVER_CACHE_KEY =
  '__agentifui_fastify_session_resolver_cache__';
const DEFAULT_SESSION_RESOLVER_CACHE_TTL_MS = 1000;
const DEFAULT_SESSION_RESOLVER_CACHE_MAX_ENTRIES = 256;

type SessionResolverCacheEntry = {
  expiresAt: number;
  result: ResolveProfileStatusResult;
};

type SessionResolverCacheState = {
  cache: Map<string, SessionResolverCacheEntry>;
  inflight: Map<string, Promise<ResolveProfileStatusResult>>;
};

function getSessionResolverCacheState(): SessionResolverCacheState {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[SESSION_RESOLVER_CACHE_KEY] as
    | SessionResolverCacheState
    | undefined;
  if (existing) {
    return existing;
  }

  const created: SessionResolverCacheState = {
    cache: new Map(),
    inflight: new Map(),
  };
  globalState[SESSION_RESOLVER_CACHE_KEY] = created;
  return created;
}

function getSessionResolverCacheTtlMs(): number {
  const parsed = Number(
    process.env.FASTIFY_SESSION_IDENTITY_CACHE_TTL_MS ||
      DEFAULT_SESSION_RESOLVER_CACHE_TTL_MS
  );
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_SESSION_RESOLVER_CACHE_TTL_MS;
  }
  return Math.floor(parsed);
}

function pruneSessionResolverCache(
  state: SessionResolverCacheState,
  now: number
): void {
  for (const [key, entry] of state.cache.entries()) {
    if (entry.expiresAt <= now) {
      state.cache.delete(key);
    }
  }

  while (state.cache.size > DEFAULT_SESSION_RESOLVER_CACHE_MAX_ENTRIES) {
    const oldestKey = state.cache.keys().next().value;
    if (!oldestKey) {
      return;
    }
    state.cache.delete(oldestKey);
  }
}

function buildSessionResolverCacheKey(tokens: string[]): string {
  return tokens.join('\u0001');
}

async function resolveProfileStatusLocallyByTokens(
  tokens: string[]
): Promise<ResolveProfileStatusResult> {
  if (tokens.length === 0) {
    return { kind: 'unauthorized' };
  }

  try {
    const rows = await queryRowsWithPgSystemContext<SessionIdentityRow>(
      `
        SELECT
          s.user_id::text AS auth_user_id,
          COALESCE(ui.user_id, s.user_id)::text AS user_id,
          p.role::text AS role,
          p.status::text AS status
        FROM auth_sessions s
        LEFT JOIN user_identities ui
          ON ui.issuer = $2::text
          AND ui.subject = s.user_id::text
        LEFT JOIN profiles p
          ON p.id = COALESCE(ui.user_id, s.user_id)
        WHERE s.expires_at > NOW()
          AND s.token = ANY($1::text[])
        ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
        LIMIT 1
      `,
      [tokens, INTERNAL_AUTH_ISSUER]
    );

    const row = rows[0];
    if (!row || !row.auth_user_id || !row.user_id) {
      return { kind: 'unauthorized' };
    }

    const status = normalizeStatus(row.status);
    if (status !== 'active') {
      return { kind: 'unauthorized' };
    }

    return {
      kind: 'ok',
      identity: {
        userId: row.user_id,
        authUserId: row.auth_user_id,
        role: normalizeRole(row.role),
        status,
      },
    };
  } catch (error) {
    return {
      kind: 'error',
      reason:
        error instanceof Error
          ? error.message
          : 'Unknown local profile-status resolve error',
    };
  }
}

async function resolveProfileStatusLocally(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<ResolveProfileStatusResult> {
  const tokens = extractCandidateSessionTokens(request, config);
  if (tokens.length === 0) {
    return { kind: 'unauthorized' };
  }

  const cacheKey = buildSessionResolverCacheKey(tokens);
  const state = getSessionResolverCacheState();
  const now = Date.now();

  pruneSessionResolverCache(state, now);

  const cached = state.cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  const existing = state.inflight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = resolveProfileStatusLocallyByTokens(tokens)
    .then(result => {
      const ttlMs = getSessionResolverCacheTtlMs();
      if (result.kind === 'ok' && ttlMs > 0) {
        state.cache.set(cacheKey, {
          result,
          expiresAt: Date.now() + ttlMs,
        });
        pruneSessionResolverCache(state, Date.now());
      }
      return result;
    })
    .finally(() => {
      state.inflight.delete(cacheKey);
    });

  state.inflight.set(cacheKey, promise);
  return promise;
}

export async function resolveProfileStatusFromSession(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<ResolveProfileStatusResult> {
  const local = await resolveProfileStatusLocally(request, config);
  if (local.kind === 'ok') {
    bumpResolverMetric('local_ok');
    return local;
  }
  if (local.kind === 'unauthorized') {
    bumpResolverMetric('local_unauthorized');
    return local;
  }
  bumpResolverMetric('local_error');
  return local;
}

export async function resolveIdentityFromSession(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<ResolveIdentityResult> {
  const resolved = await resolveProfileStatusFromSession(request, config);
  if (resolved.kind !== 'ok') {
    return resolved;
  }

  return {
    kind: 'ok',
    identity: {
      userId: resolved.identity.userId,
      authUserId: resolved.identity.authUserId,
      role: resolved.identity.role,
    },
  };
}
