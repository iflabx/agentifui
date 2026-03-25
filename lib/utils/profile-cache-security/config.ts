function parseTrustedHost(candidate: string | undefined): string | null {
  const raw = (candidate || '').trim();
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw).host;
  } catch {
    const withoutScheme = raw.replace(/^[a-z]+:\/\//i, '');
    return withoutScheme.split('/')[0]?.trim() || null;
  }
}

function collectTrustedAvatarHosts(): string[] {
  const configuredHosts = (process.env.TRUSTED_AVATAR_HOSTS || '')
    .split(',')
    .map(host => parseTrustedHost(host))
    .filter((host): host is string => Boolean(host));

  const derivedHosts = [
    parseTrustedHost(process.env.NEXT_PUBLIC_APP_URL),
    parseTrustedHost(process.env.S3_PUBLIC_BASE_URL),
    parseTrustedHost(process.env.S3_ENDPOINT),
  ].filter((host): host is string => Boolean(host));

  return Array.from(new Set([...configuredHosts, ...derivedHosts]));
}

export const SECURITY_CONFIG = {
  ALLOWED_AVATAR_PROTOCOLS: ['http:', 'https:'],
  TRUSTED_AVATAR_HOSTS: collectTrustedAvatarHosts(),
  MAX_URL_LENGTH: 2048,
  DANGEROUS_PATTERNS: [
    /javascript:/i,
    /vbscript:/i,
    /data:.*script/i,
    /onload=/i,
    /onerror=/i,
    /onclick=/i,
    /onmouseover=/i,
    /<script/i,
    /<iframe/i,
    /&lt;script/i,
  ],
  MAX_FIELD_LENGTH: {
    full_name: 255,
    username: 100,
    employee_number: 50,
  },
} as const;

export const __SECURITY_CONFIG_FOR_TESTING__ = SECURITY_CONFIG;
