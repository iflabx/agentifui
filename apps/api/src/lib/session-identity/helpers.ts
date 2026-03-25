import type { FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../../config';
import type { SessionResolverMetricKey, SessionResolverMetrics } from './types';

export const INTERNAL_AUTH_ISSUER = 'urn:agentifui:better-auth';

const SESSION_RESOLVER_METRICS_KEY =
  '__agentifui_fastify_session_resolver_metrics__';
const DEFAULT_MAX_SESSION_TOKEN_CANDIDATES = 8;

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
  };
  globalState[SESSION_RESOLVER_METRICS_KEY] = created;
  return created;
}

export function bumpResolverMetric(key: SessionResolverMetricKey): void {
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

export function extractCandidateSessionTokens(
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

export function normalizeRole(role: string | null): string {
  const normalized = (role || '').trim().toLowerCase();
  return normalized.length > 0 ? normalized : 'user';
}

export function normalizeStatus(status: string | null): string | null {
  const normalized = (status || '').trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
