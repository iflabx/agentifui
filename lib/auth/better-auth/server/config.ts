import { createBetterAuthSecondaryStorage } from '../secondary-storage';
import { INTERNAL_AUTH_PROXY_HEADER } from './constants';
import {
  parseBooleanEnv,
  parseNonNegativeIntegerEnv,
  parsePositiveIntegerEnv,
} from './env';

export function getAuthSecondaryStorage() {
  const hasRedisConfig = Boolean(
    process.env.REDIS_URL?.trim() || process.env.REDIS_HOST?.trim()
  );

  if (!hasRedisConfig) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'REDIS_URL (or REDIS_HOST) is required in production when better-auth secondary storage is enabled'
      );
    }

    console.warn(
      '[better-auth] REDIS_URL/REDIS_HOST is missing; secondary storage disabled (dev/test only)'
    );
    return undefined;
  }

  return createBetterAuthSecondaryStorage();
}

export function getAuthSessionConfig() {
  const expiresIn = parsePositiveIntegerEnv(
    process.env.BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS
  );
  const updateAge = parseNonNegativeIntegerEnv(
    process.env.BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS
  );

  const sessionConfig = {
    modelName: 'auth_sessions',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      userId: 'user_id',
    },
    storeSessionInDatabase: parseBooleanEnv(
      process.env.BETTER_AUTH_STORE_SESSION_IN_DB,
      true
    ),
    preserveSessionInDatabase: parseBooleanEnv(
      process.env.BETTER_AUTH_PRESERVE_SESSION_IN_DB,
      false
    ),
  } as const;

  return {
    ...sessionConfig,
    ...(typeof expiresIn === 'number' ? { expiresIn } : {}),
    ...(typeof updateAge === 'number' ? { updateAge } : {}),
  };
}

function hasInternalAuthProxyHeader(request: Request): boolean {
  return request.headers.get(INTERNAL_AUTH_PROXY_HEADER) === '1';
}

export function getAuthRateLimitConfig() {
  const bypassInternalProxyRule = (
    request: Request,
    currentRule: { window: number; max: number }
  ) => {
    if (hasInternalAuthProxyHeader(request)) {
      return false;
    }

    return currentRule;
  };

  return {
    customRules: {
      '/get-session': bypassInternalProxyRule,
      '/sign-out': bypassInternalProxyRule,
    },
  };
}
