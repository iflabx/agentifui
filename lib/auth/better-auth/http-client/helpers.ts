import type { InternalProfileStatusPayload } from './types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

export function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function getInternalProfileStatus(): Promise<InternalProfileStatusPayload | null> {
  const response = await fetch('/api/internal/auth/profile-status', {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401 || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to resolve internal profile status (${response.status})`
    );
  }

  const payload = (await response
    .json()
    .catch(() => null)) as InternalProfileStatusPayload | null;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return payload;
}
