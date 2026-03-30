export const DEFAULT_FASTIFY_PROXY_PREFIXES = [
  '/api/content',
  '/api/internal/data',
  '/api/internal/apps',
  '/api/internal/profile',
  '/api/internal/dify-config',
  '/api/internal/fastify-health',
  '/api/admin',
  '/api/translations',
];

export function parseFastifyProxyPrefixes(rawValue: string | undefined) {
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

export function parseBooleanSwitch(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false;
  }
  const normalized = rawValue.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}
