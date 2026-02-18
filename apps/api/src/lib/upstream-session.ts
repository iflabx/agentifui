import type { FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from './pg-context';

const FASTIFY_BYPASS_HEADER = 'x-agentifui-fastify-bypass';
const INTERNAL_AUTH_ISSUER = 'urn:agentifui:better-auth';
const UPSTREAM_PROFILE_STATUS_TIMEOUT_MS = 15000;
const FORWARDED_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'user-agent',
] as const;
const SESSION_RESOLVER_METRICS_KEY =
  '__agentifui_fastify_session_resolver_metrics__';
const DEFAULT_MAX_SESSION_TOKEN_CANDIDATES = 8;

export interface ActorIdentity {
  userId: string;
  role: string;
}

export interface ProfileStatusIdentity extends ActorIdentity {
  authUserId: string;
  status: string | null;
}

type ResolveIdentityResult =
  | { kind: 'ok'; identity: ActorIdentity }
  | { kind: 'unauthorized' }
  | { kind: 'error'; reason: string };

type ResolveProfileStatusResult =
  | { kind: 'ok'; identity: ProfileStatusIdentity }
  | { kind: 'unauthorized' }
  | { kind: 'error'; reason: string };

interface SessionIdentityRow {
  auth_user_id: string | null;
  user_id: string | null;
  role: string | null;
  status: string | null;
}

type SessionResolverMetricKey =
  | 'local_ok'
  | 'local_unauthorized'
  | 'local_error'
  | 'upstream_ok'
  | 'upstream_unauthorized'
  | 'upstream_error'
  | 'fallback_used';

type SessionResolverMetrics = Record<SessionResolverMetricKey, number>;

function getSessionResolverMetrics(): SessionResolverMetrics {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[SESSION_RESOLVER_METRICS_KEY] as
    | SessionResolverMetrics
    | undefined;
  if (existing) {
    return existing;
  }

  const created: SessionResolverMetrics = {
    local_ok: 0,
    local_unauthorized: 0,
    local_error: 0,
    upstream_ok: 0,
    upstream_unauthorized: 0,
    upstream_error: 0,
    fallback_used: 0,
  };
  globalState[SESSION_RESOLVER_METRICS_KEY] = created;
  return created;
}

function bumpResolverMetric(key: SessionResolverMetricKey): void {
  const metrics = getSessionResolverMetrics();
  metrics[key] = (metrics[key] || 0) + 1;
}

export function getSessionResolverMetricsSnapshot(): SessionResolverMetrics {
  return { ...getSessionResolverMetrics() };
}

export function resetSessionResolverMetrics(): void {
  const metrics = getSessionResolverMetrics();
  for (const key of Object.keys(metrics) as SessionResolverMetricKey[]) {
    metrics[key] = 0;
  }
}

function readHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (Array.isArray(value)) {
    const joined = value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .join('; ');
    return joined.length > 0 ? joined : null;
  }

  return null;
}

function resolveSessionCookieNames(config: ApiRuntimeConfig): Set<string> {
  const names = Array.isArray(config.sessionCookieNames)
    ? config.sessionCookieNames
    : [];
  return new Set(
    names.map(name => name.trim().toLowerCase()).filter(name => name.length > 0)
  );
}

function extractCookieTokens(
  cookieHeader: string | null,
  sessionCookieNames: Set<string>
): string[] {
  if (!cookieHeader) {
    return [];
  }

  const tokens = new Set<string>();
  const addTokenCandidate = (value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    tokens.add(normalized);

    // better-auth cookie stores "<token>.<signature>" in session_token.
    const dotIndex = normalized.indexOf('.');
    if (dotIndex > 0) {
      const tokenPart = normalized.slice(0, dotIndex).trim();
      if (tokenPart) {
        tokens.add(tokenPart);
      }
    }
  };
  for (const entry of cookieHeader.split(';')) {
    const part = entry.trim();
    if (!part) {
      continue;
    }

    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = part.slice(0, eqIndex).trim().toLowerCase();
    if (!name || !sessionCookieNames.has(name)) {
      continue;
    }

    const value = part.slice(eqIndex + 1).trim();
    if (!value) {
      continue;
    }
    addTokenCandidate(value);
    try {
      const decoded = decodeURIComponent(value);
      if (decoded) {
        addTokenCandidate(decoded);
      }
    } catch {
      // Ignore malformed url-encoded cookie fragments.
    }
  }

  return Array.from(tokens).slice(0, DEFAULT_MAX_SESSION_TOKEN_CANDIDATES);
}

function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const token = match[1]?.trim();
  return token ? token : null;
}

function extractCandidateSessionTokens(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): string[] {
  const cookieHeader = readHeaderValue(request.headers.cookie);
  const authorizationHeader = readHeaderValue(request.headers.authorization);
  const tokens = new Set<string>(
    extractCookieTokens(cookieHeader, resolveSessionCookieNames(config))
  );
  const bearerToken = extractBearerToken(authorizationHeader);
  if (bearerToken) {
    tokens.add(bearerToken);
  }
  return Array.from(tokens).slice(0, DEFAULT_MAX_SESSION_TOKEN_CANDIDATES);
}

function normalizeRole(role: string | null): string {
  const normalized = (role || '').trim().toLowerCase();
  return normalized.length > 0 ? normalized : 'user';
}

function normalizeStatus(status: string | null): string | null {
  const normalized = (status || '').trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

async function resolveProfileStatusLocally(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<ResolveProfileStatusResult> {
  const tokens = extractCandidateSessionTokens(request, config);
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
    if (!row) {
      return { kind: 'unauthorized' };
    }

    if (!row.auth_user_id || !row.user_id) {
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

function buildUpstreamHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const key of FORWARDED_HEADERS) {
    const value = request.headers[key];
    if (typeof value === 'string' && value.length > 0) {
      headers.set(key, value);
    }
  }
  headers.set(FASTIFY_BYPASS_HEADER, '1');
  return headers;
}

async function resolveProfileStatusViaUpstream(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<ResolveProfileStatusResult> {
  const url = new URL(
    '/api/internal/auth/profile-status',
    config.nextUpstreamBaseUrl
  ).toString();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    UPSTREAM_PROFILE_STATUS_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildUpstreamHeaders(request),
      signal: controller.signal,
    });

    if (response.status === 401) {
      return { kind: 'unauthorized' };
    }
    if (!response.ok) {
      return {
        kind: 'error',
        reason: `Upstream profile-status failed with ${response.status}`,
      };
    }

    const payload = (await response.json()) as {
      userId?: unknown;
      authUserId?: unknown;
      role?: unknown;
      status?: unknown;
    };
    if (
      typeof payload.userId !== 'string' ||
      payload.userId.trim().length === 0
    ) {
      return {
        kind: 'error',
        reason: 'Upstream profile-status payload missing userId',
      };
    }

    const authUserId =
      typeof payload.authUserId === 'string' &&
      payload.authUserId.trim().length > 0
        ? payload.authUserId
        : payload.userId;
    const role =
      typeof payload.role === 'string' && payload.role.trim().length > 0
        ? payload.role
        : 'user';
    const status =
      typeof payload.status === 'string' && payload.status.trim().length > 0
        ? payload.status.trim().toLowerCase()
        : null;
    if (status !== 'active') {
      return { kind: 'unauthorized' };
    }
    return {
      kind: 'ok',
      identity: {
        userId: payload.userId,
        authUserId,
        role,
        status,
      },
    };
  } catch (error) {
    return {
      kind: 'error',
      reason:
        error instanceof Error
          ? error.message
          : 'Unknown upstream profile-status error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveProfileStatusFromUpstream(
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

  if (!config.upstreamProfileStatusFallbackEnabled) {
    return local;
  }

  bumpResolverMetric('fallback_used');
  const upstream = await resolveProfileStatusViaUpstream(request, config);
  if (upstream.kind === 'ok') {
    bumpResolverMetric('upstream_ok');
    return upstream;
  }
  if (upstream.kind === 'unauthorized') {
    bumpResolverMetric('upstream_unauthorized');
    return upstream;
  }
  bumpResolverMetric('upstream_error');
  return upstream;
}

export async function resolveIdentityFromUpstream(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<ResolveIdentityResult> {
  const resolved = await resolveProfileStatusFromUpstream(request, config);
  if (resolved.kind !== 'ok') {
    return resolved;
  }

  return {
    kind: 'ok',
    identity: {
      userId: resolved.identity.userId,
      role: resolved.identity.role,
    },
  };
}
