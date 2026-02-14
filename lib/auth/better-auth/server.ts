import { sso } from '@better-auth/sso';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { nextCookies } from 'better-auth/next-js';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';

import { parseSsoProvidersFromEnv, toDefaultSsoConfig } from './sso-providers';

const BETTER_AUTH_BASE_PATH = '/api/auth/better';
const MEMORY_DB_KEY = '__agentifui_better_auth_memory_db__';

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

const parsedSsoProviders = parseSsoProvidersFromEnv(
  process.env.BETTER_AUTH_SSO_PROVIDERS_JSON
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

const parsedGenericOAuthProviders = parseGenericOAuthProvidersFromEnv(
  process.env.BETTER_AUTH_GENERIC_OAUTH_PROVIDERS_JSON
);

parsedGenericOAuthProviders.warnings.forEach(message => {
  console.warn(message);
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

export const auth = betterAuth({
  baseURL: getBaseUrl(),
  basePath: BETTER_AUTH_BASE_PATH,
  secret: getSecret(),
  database: memoryAdapter(getMemoryDb(), {}),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    nextCookies(),
    ...(parsedGenericOAuthProviders.providers.length > 0
      ? [genericOAuth({ config: parsedGenericOAuthProviders.providers })]
      : []),
    sso({
      defaultSSO: toDefaultSsoConfig(parsedSsoProviders.providers),
    }),
  ],
});
