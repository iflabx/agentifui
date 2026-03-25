function splitEnvList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function getBaseUrl(): string {
  if (process.env.BETTER_AUTH_URL) {
    return process.env.BETTER_AUTH_URL;
  }

  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  return 'http://localhost:3000';
}

export function getTrustedOrigins(): string[] {
  const values = [
    getBaseUrl(),
    process.env.NEXT_PUBLIC_APP_URL,
    ...splitEnvList(process.env.BETTER_AUTH_TRUSTED_ORIGINS),
    ...splitEnvList(process.env.CORS_ALLOWED_ORIGINS),
    ...(process.env.NODE_ENV === 'development'
      ? splitEnvList(process.env.DEV_ALLOWED_ORIGINS)
      : []),
  ];

  const trustedOrigins = values
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value))
    .map(value => {
      const normalized = normalizeOrigin(value);
      if (!normalized) {
        console.warn(
          `[better-auth] ignoring invalid trusted origin entry: ${value}`
        );
      }
      return normalized;
    })
    .filter((value): value is string => Boolean(value));

  return [...new Set(trustedOrigins)];
}

export function getSecret(): string {
  const betterAuthSecret = process.env.BETTER_AUTH_SECRET?.trim();
  if (betterAuthSecret) {
    return betterAuthSecret;
  }

  const authSecretFallback = process.env.AUTH_SECRET?.trim();
  if (authSecretFallback) {
    return authSecretFallback;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'BETTER_AUTH_SECRET (or AUTH_SECRET fallback) is required in production when better-auth is enabled'
    );
  }

  return 'dev-only-better-auth-secret-change-me';
}

export function parseBooleanEnv(
  value: string | undefined,
  fallback: boolean
): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function parsePositiveIntegerEnv(
  value: string | undefined
): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

export function parseNonNegativeIntegerEnv(
  value: string | undefined
): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

export function shouldUseStrictSsoValidation(): boolean {
  const override = process.env.BETTER_AUTH_SSO_STRICT;
  if (typeof override === 'string' && override.trim().length > 0) {
    return parseBooleanEnv(override, false);
  }

  return (
    process.env.NODE_ENV === 'production' ||
    parseBooleanEnv(process.env.CI, false)
  );
}

export function isPhoneNumberAuthEnabled(): boolean {
  return parseBooleanEnv(process.env.AUTH_PHONE_OTP_ENABLED, true);
}
