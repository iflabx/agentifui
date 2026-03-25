import type { IdentityPersistenceContext } from '@lib/db/user-identities';

export const INTERNAL_AUTH_ISSUER = 'urn:agentifui:better-auth';
export const INTERNAL_AUTH_PROVIDER = 'better-auth';
export const PROVIDER_ISSUER_PREFIX = 'urn:better-auth:provider:';
export const LEGACY_MAPPING_LOCK_PREFIX = 'legacy-auth-user';
const DEFAULT_EXTERNAL_ATTRIBUTES_SYNC_INTERVAL_MS = 15 * 60 * 1000;
export const MISSING_IDENTITY_MAPPING_ERROR_MESSAGE =
  'Missing identity mapping for non-UUID auth session user';
export const MISSING_PROFILE_ROW_ERROR_MESSAGE =
  'Missing profile row for session user';

export const SYSTEM_CONTEXT: IdentityPersistenceContext = {
  useSystemActor: true,
};

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = (value || '').trim().toLowerCase();
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
}

function parseBooleanEnv(
  value: string | undefined,
  fallbackValue: boolean
): boolean {
  if (!value) {
    return fallbackValue;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  ) {
    return true;
  }
  if (
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'no' ||
    normalized === 'off'
  ) {
    return false;
  }
  return fallbackValue;
}

export function shouldInlineIdentitySync(): boolean {
  return isTruthyEnv(process.env.AUTH_IDENTITY_SYNC_INLINE);
}

export function shouldRecoverMissingMappingOnReadOnlyResolve(): boolean {
  return parseBooleanEnv(
    process.env.AUTH_IDENTITY_RECOVER_MISSING_MAPPING,
    true
  );
}

export function isRecoverableReadOnlyIdentityError(
  error: Error | null | undefined
): boolean {
  const message = error?.message || '';
  return (
    message.includes(MISSING_IDENTITY_MAPPING_ERROR_MESSAGE) ||
    message.includes(MISSING_PROFILE_ROW_ERROR_MESSAGE)
  );
}

export function getExternalAttributesSyncIntervalMs(): number {
  const parsed = Number(process.env.EXTERNAL_ATTRIBUTES_SYNC_INTERVAL_MS);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return DEFAULT_EXTERNAL_ATTRIBUTES_SYNC_INTERVAL_MS;
}

export function shouldUseIntervalExternalAttributesSync(): boolean {
  return (
    (process.env.EXTERNAL_ATTRIBUTES_SYNC_MODE || '').trim().toLowerCase() ===
    'interval'
  );
}
