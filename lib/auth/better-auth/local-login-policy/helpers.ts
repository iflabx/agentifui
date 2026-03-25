import type { AuthMode, ProfileLocalLoginStateRow, RealtimeRow } from './types';

const LOCAL_PASSWORD_AUTH_SOURCES = new Set([
  '',
  'password',
  'better-auth',
  'credentials',
]);

export function normalizeEmail(
  email: string | null | undefined
): string | null {
  if (typeof email !== 'string') {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeAuthMode(input: string | null | undefined): AuthMode {
  if (input === 'degraded') {
    return 'degraded';
  }

  return 'normal';
}

export function isLocalPasswordAuthSource(authSource: string): boolean {
  return LOCAL_PASSWORD_AUTH_SOURCES.has(authSource);
}

export function isAuthMode(input: string): input is AuthMode {
  return input === 'normal' || input === 'degraded';
}

export function toIsoString(
  value: string | Date | null | undefined
): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export function toProfileRealtimeRow(
  row: ProfileLocalLoginStateRow | null
): RealtimeRow | null {
  if (!row?.id) {
    return null;
  }

  return {
    id: row.id,
    email: row.email ?? null,
    auth_source: row.auth_source ?? null,
    local_login_enabled: Boolean(row.local_login_enabled),
    local_login_updated_at: toIsoString(row.local_login_updated_at),
    fallback_password_set_at: toIsoString(row.fallback_password_set_at),
    fallback_password_updated_by: row.fallback_password_updated_by ?? null,
    updated_at: toIsoString(row.updated_at),
  };
}

export function parseSignInEmailFromRequest(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const value = (payload as Record<string, unknown>).email;
  return normalizeEmail(typeof value === 'string' ? value : null);
}

export function extractClientIp(request: Request): string | null {
  const xForwardedFor = request.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    const firstHop = xForwardedFor.split(',')[0]?.trim();
    if (firstHop) {
      return firstHop;
    }
  }

  const xRealIp = request.headers.get('x-real-ip')?.trim();
  return xRealIp || null;
}
