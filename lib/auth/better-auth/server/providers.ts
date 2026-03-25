import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';

import { parseSsoProvidersFromEnv, toDefaultSsoConfig } from '../sso-providers';
import { shouldUseStrictSsoValidation } from './env';

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

export function getSsoPluginConfig() {
  return toDefaultSsoConfig(parsedSsoProviders.providers);
}

export function getGenericOAuthProviders() {
  return parsedGenericOAuthProviders.providers;
}
