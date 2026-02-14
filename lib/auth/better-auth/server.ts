import { sso } from '@better-auth/sso';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { nextCookies } from 'better-auth/next-js';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { phoneNumber } from 'better-auth/plugins/phone-number';
import { Pool } from 'pg';

import { sendResetPasswordEmail } from './password-reset';
import { getPhoneNumberPluginOptions } from './phone-otp';
import { createBetterAuthSecondaryStorage } from './secondary-storage';
import { parseSsoProvidersFromEnv, toDefaultSsoConfig } from './sso-providers';

const BETTER_AUTH_BASE_PATH = '/api/auth/better';
const MEMORY_DB_KEY = '__agentifui_better_auth_memory_db__';
const BETTER_AUTH_KYSELY_KEY = '__agentifui_better_auth_kysely__';
type KyselyDb = unknown;

function getBaseUrl(): string {
  if (process.env.BETTER_AUTH_URL) {
    return process.env.BETTER_AUTH_URL;
  }

  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  return 'http://localhost:3000';
}

function getSecret(): string {
  if (process.env.BETTER_AUTH_SECRET) {
    return process.env.BETTER_AUTH_SECRET;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'BETTER_AUTH_SECRET is required in production when better-auth is enabled'
    );
  }

  return 'dev-only-better-auth-secret-change-me';
}

function parseBooleanEnv(
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

function parsePositiveIntegerEnv(
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

function parseNonNegativeIntegerEnv(
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

function shouldUseStrictSsoValidation(): boolean {
  const override = process.env.BETTER_AUTH_SSO_STRICT;
  if (typeof override === 'string' && override.trim().length > 0) {
    return parseBooleanEnv(override, false);
  }

  return (
    process.env.NODE_ENV === 'production' ||
    parseBooleanEnv(process.env.CI, false)
  );
}

function isPhoneNumberAuthEnabled(): boolean {
  return parseBooleanEnv(process.env.AUTH_PHONE_OTP_ENABLED, true);
}

function getMemoryDb() {
  const globalState = globalThis as unknown as Record<string, unknown>;
  if (!globalState[MEMORY_DB_KEY]) {
    globalState[MEMORY_DB_KEY] = {};
  }

  const db = globalState[MEMORY_DB_KEY] as Record<string, unknown[]>;
  const requiredModels = ['user', 'session', 'account', 'verification'];

  requiredModels.forEach(model => {
    if (!Array.isArray(db[model])) {
      db[model] = [];
    }
  });

  return db;
}

function resolveDatabaseUrl(): string | null {
  const fromPrimary = process.env.DATABASE_URL?.trim();
  if (fromPrimary) {
    return fromPrimary;
  }

  const fallback = process.env.PGURL?.trim();
  if (fallback) {
    return fallback;
  }

  return null;
}

function loadKyselyRuntime(): {
  Kysely: new (config: unknown) => unknown;
  PostgresDialect: new (config: unknown) => unknown;
} {
  const runtimeRequire = eval('require') as (id: string) => unknown;

  try {
    return runtimeRequire('kysely') as {
      Kysely: new (config: unknown) => unknown;
      PostgresDialect: new (config: unknown) => unknown;
    };
  } catch {
    return runtimeRequire('better-auth/node_modules/kysely') as {
      Kysely: new (config: unknown) => unknown;
      PostgresDialect: new (config: unknown) => unknown;
    };
  }
}

function getKyselyDb(connectionString: string) {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[BETTER_AUTH_KYSELY_KEY] as KyselyDb | undefined;
  if (existing) {
    return existing;
  }

  const { Kysely, PostgresDialect } = loadKyselyRuntime();
  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_POOL_CONNECT_MS || 5000),
  });

  const db = new Kysely({
    dialect: new PostgresDialect({ pool }),
  }) as KyselyDb;

  globalState[BETTER_AUTH_KYSELY_KEY] = db;
  return db;
}

function getAuthDatabaseConfig() {
  const databaseUrl = resolveDatabaseUrl();
  if (databaseUrl) {
    return {
      db: getKyselyDb(databaseUrl),
      type: 'postgres' as const,
    };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_URL (or PGURL) is required in production when better-auth is enabled'
    );
  }

  console.warn(
    '[better-auth] DATABASE_URL/PGURL is missing; using in-memory adapter (dev/test only)'
  );
  return memoryAdapter(getMemoryDb(), {});
}

function getAuthSecondaryStorage() {
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

function getAuthSessionConfig() {
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

const parsedSsoProviders = parseSsoProvidersFromEnv(
  process.env.BETTER_AUTH_SSO_PROVIDERS_JSON,
  {
    strictCasBridge: shouldUseStrictSsoValidation(),
  }
);

parsedSsoProviders.warnings.forEach(message => {
  console.warn(message);
});

function parseGenericOAuthProvidersFromEnv(rawValue?: string): {
  providers: GenericOAuthConfig[];
  warnings: string[];
} {
  if (!rawValue || !rawValue.trim()) {
    return { providers: [], warnings: [] };
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return {
        providers: [],
        warnings: [
          '[better-auth] BETTER_AUTH_GENERIC_OAUTH_PROVIDERS_JSON must be a JSON array',
        ],
      };
    }

    const warnings: string[] = [];
    const providers: GenericOAuthConfig[] = [];

    for (let index = 0; index < parsed.length; index += 1) {
      const item = parsed[index];
      if (!item || typeof item !== 'object') {
        warnings.push(
          `[better-auth] generic oauth provider at index ${index} is not an object; skipped`
        );
        continue;
      }

      const providerId =
        typeof item.providerId === 'string' ? item.providerId.trim() : '';
      const clientId =
        typeof item.clientId === 'string' ? item.clientId.trim() : '';
      const clientSecret =
        typeof item.clientSecret === 'string' ? item.clientSecret.trim() : '';
      const authorizationUrl =
        typeof item.authorizationUrl === 'string'
          ? item.authorizationUrl.trim()
          : '';
      const tokenUrl =
        typeof item.tokenUrl === 'string' ? item.tokenUrl.trim() : '';
      const userInfoUrl =
        typeof item.userInfoUrl === 'string' ? item.userInfoUrl.trim() : '';
      const discoveryUrl =
        typeof item.discoveryUrl === 'string' ? item.discoveryUrl.trim() : '';

      if (!providerId || !clientId) {
        warnings.push(
          `[better-auth] generic oauth provider at index ${index} missing providerId/clientId; skipped`
        );
        continue;
      }

      const hasDiscovery = Boolean(discoveryUrl);
      const hasEndpoints = Boolean(authorizationUrl && tokenUrl);
      if (!hasDiscovery && !hasEndpoints) {
        warnings.push(
          `[better-auth] generic oauth provider "${providerId}" missing discoveryUrl or authorizationUrl+tokenUrl; skipped`
        );
        continue;
      }

      providers.push({
        providerId,
        clientId,
        clientSecret: clientSecret || undefined,
        discoveryUrl: discoveryUrl || undefined,
        authorizationUrl: authorizationUrl || undefined,
        tokenUrl: tokenUrl || undefined,
        userInfoUrl: userInfoUrl || undefined,
        scopes: Array.isArray(item.scopes)
          ? item.scopes
              .filter(
                (scope: unknown): scope is string => typeof scope === 'string'
              )
              .map((scope: string) => scope.trim())
              .filter(Boolean)
          : undefined,
      });
    }

    return { providers, warnings };
  } catch (error) {
    return {
      providers: [],
      warnings: [
        `[better-auth] failed to parse BETTER_AUTH_GENERIC_OAUTH_PROVIDERS_JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function issuerFromDiscoveryUrl(discoveryUrl?: string): string | null {
  if (!discoveryUrl || !discoveryUrl.trim()) {
    return null;
  }

  try {
    const parsed = new URL(discoveryUrl.trim());
    const marker = '/.well-known/';
    const markerIndex = parsed.pathname.indexOf(marker);
    const basePath =
      markerIndex >= 0
        ? parsed.pathname.slice(0, markerIndex)
        : parsed.pathname;
    const normalizedPath = basePath === '/' ? '' : stripTrailingSlash(basePath);
    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return null;
  }
}

const parsedGenericOAuthProviders = parseGenericOAuthProvidersFromEnv(
  process.env.BETTER_AUTH_GENERIC_OAUTH_PROVIDERS_JSON
);

parsedGenericOAuthProviders.warnings.forEach(message => {
  console.warn(message);
});

const providerIssuerMap = new Map<string, string>();

parsedSsoProviders.providers.forEach(provider => {
  providerIssuerMap.set(
    provider.providerId,
    stripTrailingSlash(provider.oidcConfig.issuer)
  );
});

parsedGenericOAuthProviders.providers.forEach(provider => {
  const issuer = issuerFromDiscoveryUrl(provider.discoveryUrl);
  if (issuer) {
    providerIssuerMap.set(provider.providerId, issuer);
  }
});

export function getPublicSsoProviders() {
  return parsedSsoProviders.providers.map(provider => ({
    providerId: provider.providerId,
    domain: provider.domain,
    displayName: provider.displayName,
    icon: provider.icon ?? '🏛️',
    mode: provider.mode,
  }));
}

export function getAuthProviderIssuer(providerId: string): string | null {
  const normalizedProviderId = providerId.trim();
  if (!normalizedProviderId) {
    return null;
  }

  return providerIssuerMap.get(normalizedProviderId) ?? null;
}

export const auth = betterAuth({
  baseURL: getBaseUrl(),
  basePath: BETTER_AUTH_BASE_PATH,
  secret: getSecret(),
  database: getAuthDatabaseConfig(),
  secondaryStorage: getAuthSecondaryStorage(),
  user: {
    modelName: 'auth_users',
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  session: getAuthSessionConfig(),
  account: {
    modelName: 'auth_accounts',
    fields: {
      accountId: 'account_id',
      providerId: 'provider_id',
      userId: 'user_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    modelName: 'auth_verifications',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: sendResetPasswordEmail,
    revokeSessionsOnPasswordReset: true,
  },
  plugins: [
    nextCookies(),
    ...(isPhoneNumberAuthEnabled()
      ? [phoneNumber(getPhoneNumberPluginOptions())]
      : []),
    ...(parsedGenericOAuthProviders.providers.length > 0
      ? [genericOAuth({ config: parsedGenericOAuthProviders.providers })]
      : []),
    sso({
      defaultSSO: toDefaultSsoConfig(parsedSsoProviders.providers),
    }),
  ],
});
