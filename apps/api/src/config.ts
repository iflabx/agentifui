export const DEFAULT_FASTIFY_PROXY_PREFIXES = [
  '/api/internal/data',
  '/api/internal/apps',
  '/api/internal/profile',
  '/api/internal/dify-config',
  '/api/internal/auth/local-password',
  '/api/internal/fastify-health',
  '/api/admin',
  '/api/translations',
];

export interface ApiRuntimeConfig {
  host: string;
  port: number;
  logLevel: string;
  nextUpstreamBaseUrl: string;
  proxyPrefixes: string[];
  sessionCookieNames: string[];
  internalDataProxyTimeoutMs: number;
  internalDataLegacyFallbackEnabled: boolean;
  upstreamProfileStatusFallbackEnabled: boolean;
}

const DEFAULT_SESSION_COOKIE_NAMES = [
  'session_token',
  'better-auth.session_token',
  '__Secure-session_token',
  '__Secure-better-auth.session_token',
];

function parsePort(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number(rawValue.trim());
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function parseTimeoutMs(
  rawValue: string | undefined,
  fallback: number
): number {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue.trim());
  if (!Number.isFinite(parsed) || parsed < 1000) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseBoolean(
  rawValue: string | undefined,
  fallback: boolean
): boolean {
  if (!rawValue) {
    return fallback;
  }
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }
  return fallback;
}

function parseProxyPrefixes(rawValue: string | undefined): string[] {
  const source =
    typeof rawValue === 'string' && rawValue.trim().length > 0
      ? rawValue
      : DEFAULT_FASTIFY_PROXY_PREFIXES.join(',');
  const seen = new Set<string>();
  return source
    .split(',')
    .map(prefix => prefix.trim())
    .filter(Boolean)
    .map(prefix => (prefix.startsWith('/') ? prefix : `/${prefix}`))
    .map(prefix => (prefix.length > 1 ? prefix.replace(/\/+$/, '') : prefix))
    .filter(prefix => {
      if (seen.has(prefix)) {
        return false;
      }
      seen.add(prefix);
      return true;
    });
}

function parseSessionCookieNames(rawValue: string | undefined): string[] {
  const source =
    typeof rawValue === 'string' && rawValue.trim().length > 0
      ? rawValue
      : DEFAULT_SESSION_COOKIE_NAMES.join(',');
  const seen = new Set<string>();
  return source
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
    .filter(name => {
      const normalized = name.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

export function loadApiRuntimeConfig(): ApiRuntimeConfig {
  return {
    host: process.env.FASTIFY_API_HOST?.trim() || '0.0.0.0',
    port: parsePort(process.env.FASTIFY_API_PORT, 3010),
    logLevel: process.env.FASTIFY_LOG_LEVEL?.trim() || 'info',
    nextUpstreamBaseUrl:
      process.env.NEXT_UPSTREAM_BASE_URL?.trim() || 'http://127.0.0.1:3000',
    proxyPrefixes: parseProxyPrefixes(process.env.FASTIFY_PROXY_PREFIXES),
    sessionCookieNames: parseSessionCookieNames(
      process.env.FASTIFY_AUTH_SESSION_COOKIE_NAMES
    ),
    internalDataProxyTimeoutMs: parseTimeoutMs(
      process.env.FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS,
      30000
    ),
    internalDataLegacyFallbackEnabled: parseBoolean(
      process.env.FASTIFY_INTERNAL_DATA_LEGACY_FALLBACK_ENABLED,
      false
    ),
    upstreamProfileStatusFallbackEnabled: parseBoolean(
      process.env.FASTIFY_UPSTREAM_PROFILE_STATUS_FALLBACK_ENABLED,
      false
    ),
  };
}
