export const DEFAULT_FASTIFY_PROXY_PREFIXES = [
  '/api/dify',
  '/api/content',
  '/api/internal/data',
  '/api/internal/apps',
  '/api/internal/profile',
  '/api/internal/error-events/client',
  '/api/internal/realtime',
  '/api/internal/storage',
  '/api/internal/ops/dify-resilience',
  '/api/internal/dify-config',
  '/api/internal/fastify-health',
  '/api/admin',
  '/api/translations',
];

export type RealtimeSourceMode = 'db-outbox' | 'app-direct' | 'hybrid';

export interface InputModerationAppConfig {
  apiUrl: string;
  apiKey: string;
}

export interface ApiRuntimeConfig {
  host: string;
  port: number;
  logLevel: string;
  nextUpstreamBaseUrl: string;
  proxyPrefixes: string[];
  realtimeSourceMode: RealtimeSourceMode;
  sessionCookieNames: string[];
  internalDataProxyTimeoutMs: number;
  difyTempConfigEnabled: boolean;
  difyTempConfigAllowedHosts: string[];
  difyTempConfigAllowPrivate: boolean;
  inputModeration: {
    enabled: boolean;
    app: InputModerationAppConfig | null;
  };
}

const DEFAULT_SESSION_COOKIE_NAMES = [
  'session_token',
  'better-auth.session_token',
  '__Secure-session_token',
  '__Secure-better-auth.session_token',
];

function parseBooleanEnv(
  rawValue: string | undefined,
  fallback: boolean
): boolean {
  if (!rawValue) {
    return fallback;
  }
  const normalized = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

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

function parseCsvList(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }
  const seen = new Set<string>();
  return rawValue
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => value.toLowerCase())
    .filter(value => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
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

function parseRealtimeSourceMode(
  rawValue: string | undefined
): RealtimeSourceMode {
  const normalized = (rawValue || 'db-outbox').trim().toLowerCase();
  if (normalized === 'app-direct') {
    return 'app-direct';
  }
  if (normalized === 'hybrid') {
    return 'hybrid';
  }
  return 'db-outbox';
}

function parseInputModerationApp(
  rawValue: string | undefined
): InputModerationAppConfig | null {
  if (!rawValue || rawValue.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    throw new Error(
      `Invalid DIFY_INPUT_MODERATION_APP JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      'Invalid DIFY_INPUT_MODERATION_APP: expected a JSON object'
    );
  }

  const apiUrl =
    typeof (parsed as { apiUrl?: unknown }).apiUrl === 'string'
      ? (parsed as { apiUrl: string }).apiUrl.trim()
      : '';
  const apiKey =
    typeof (parsed as { apiKey?: unknown }).apiKey === 'string'
      ? (parsed as { apiKey: string }).apiKey.trim()
      : '';

  if (!apiUrl || !apiKey) {
    throw new Error(
      'Invalid DIFY_INPUT_MODERATION_APP: apiUrl and apiKey are required'
    );
  }

  return { apiUrl, apiKey };
}

export function loadApiRuntimeConfig(): ApiRuntimeConfig {
  const inputModerationEnabled = parseBooleanEnv(
    process.env.DIFY_INPUT_MODERATION_ENABLED,
    false
  );
  const inputModerationApp = inputModerationEnabled
    ? parseInputModerationApp(process.env.DIFY_INPUT_MODERATION_APP)
    : null;

  if (inputModerationEnabled && !inputModerationApp) {
    throw new Error(
      'DIFY_INPUT_MODERATION_ENABLED=true requires DIFY_INPUT_MODERATION_APP'
    );
  }

  return {
    host: process.env.FASTIFY_API_HOST?.trim() || '0.0.0.0',
    port: parsePort(process.env.FASTIFY_API_PORT, 3010),
    logLevel: process.env.FASTIFY_LOG_LEVEL?.trim() || 'info',
    nextUpstreamBaseUrl:
      process.env.NEXT_UPSTREAM_BASE_URL?.trim() || 'http://127.0.0.1:3000',
    proxyPrefixes: parseProxyPrefixes(process.env.FASTIFY_PROXY_PREFIXES),
    realtimeSourceMode: parseRealtimeSourceMode(
      process.env.REALTIME_SOURCE_MODE
    ),
    sessionCookieNames: parseSessionCookieNames(
      process.env.FASTIFY_AUTH_SESSION_COOKIE_NAMES
    ),
    internalDataProxyTimeoutMs: parseTimeoutMs(
      process.env.FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS,
      30000
    ),
    difyTempConfigEnabled: parseBooleanEnv(
      process.env.DIFY_TEMP_CONFIG_ENABLED,
      false
    ),
    difyTempConfigAllowedHosts: parseCsvList(
      process.env.DIFY_TEMP_CONFIG_ALLOWED_HOSTS
    ),
    difyTempConfigAllowPrivate: parseBooleanEnv(
      process.env.DIFY_TEMP_CONFIG_ALLOW_PRIVATE,
      false
    ),
    inputModeration: {
      enabled: inputModerationEnabled,
      app: inputModerationApp,
    },
  };
}
