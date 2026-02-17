export const DEFAULT_FASTIFY_PROXY_PREFIXES = [
  '/api/internal',
  '/api/internal/storage',
  '/api/internal/realtime',
  '/api/dify',
  '/api/admin',
  '/api/translations',
];

export interface ApiRuntimeConfig {
  host: string;
  port: number;
  logLevel: string;
  nextUpstreamBaseUrl: string;
  proxyPrefixes: string[];
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

export function loadApiRuntimeConfig(): ApiRuntimeConfig {
  return {
    host: process.env.FASTIFY_API_HOST?.trim() || '0.0.0.0',
    port: parsePort(process.env.FASTIFY_API_PORT, 3010),
    logLevel: process.env.FASTIFY_LOG_LEVEL?.trim() || 'info',
    nextUpstreamBaseUrl:
      process.env.NEXT_UPSTREAM_BASE_URL?.trim() || 'http://127.0.0.1:3000',
    proxyPrefixes: parseProxyPrefixes(process.env.FASTIFY_PROXY_PREFIXES),
  };
}
