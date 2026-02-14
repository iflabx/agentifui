import { sso } from '@better-auth/sso';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { nextCookies } from 'better-auth/next-js';

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

  return globalState[MEMORY_DB_KEY] as Record<string, unknown[]>;
}

const parsedSsoProviders = parseSsoProvidersFromEnv(
  process.env.BETTER_AUTH_SSO_PROVIDERS_JSON
);

parsedSsoProviders.warnings.forEach(message => {
  console.warn(message);
});

export const isBetterAuthEnabled =
  process.env.BETTER_AUTH_ENABLED === 'true' ||
  process.env.AUTH_BACKEND === 'better-auth';

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
    sso({
      defaultSSO: toDefaultSsoConfig(parsedSsoProviders.providers),
    }),
  ],
});
