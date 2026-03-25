import { IdentityPersistenceContext } from './types';

export function normalizeIssuer(issuer: string): string {
  return issuer.trim().toLowerCase();
}

export function normalizeSubject(subject: string): string {
  return subject.trim();
}

export function normalizeProvider(provider: string): string {
  return provider.trim();
}

export function normalizeActorUserId(
  userId: string | null | undefined
): string | null {
  if (typeof userId !== 'string') {
    return null;
  }

  const normalized = userId.trim();
  return normalized.length > 0 ? normalized : null;
}

export function hasContext(context?: IdentityPersistenceContext): boolean {
  const actorUserId = normalizeActorUserId(context?.actorUserId);
  return Boolean(actorUserId || context?.useSystemActor);
}

export function normalizeTimestamps<T extends object>(row: T): T {
  const normalized: Record<string, unknown> = {
    ...(row as Record<string, unknown>),
  };

  const timestampFields = [
    'created_at',
    'updated_at',
    'last_login_at',
    'synced_at',
    'last_seen_at',
  ];

  timestampFields.forEach(field => {
    const value = normalized[field];
    if (value instanceof Date) {
      normalized[field] = value.toISOString();
    }
  });

  return normalized as T;
}
