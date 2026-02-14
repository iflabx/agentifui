import type { OIDCConfig, SSOOptions } from '@better-auth/sso';

type BridgeMode = 'native' | 'cas-bridge';
type TokenEndpointAuth = 'client_secret_basic' | 'client_secret_post';

interface EnvSsoProvider {
  providerId: string;
  domain: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  discoveryEndpoint?: string;
  tokenEndpointAuthentication?: TokenEndpointAuth;
  scopes?: string[];
  pkce?: boolean;
  mode?: BridgeMode;
  casIssuer?: string;
}

export interface ParsedSsoProvider {
  providerId: string;
  domain: string;
  mode: BridgeMode;
  casIssuer?: string;
  oidcConfig: OIDCConfig;
}

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];

function ensureString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid SSO provider field "${fieldName}"`);
  }

  return value.trim();
}

function normalizeIssuer(issuer: string): string {
  return issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
}

function toOidcConfig(input: EnvSsoProvider): OIDCConfig {
  const issuer = normalizeIssuer(input.issuer);
  const discoveryEndpoint =
    input.discoveryEndpoint?.trim() ||
    `${issuer}/.well-known/openid-configuration`;

  return {
    issuer,
    discoveryEndpoint,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    pkce: input.pkce ?? true,
    scopes:
      Array.isArray(input.scopes) && input.scopes.length > 0
        ? input.scopes
        : DEFAULT_SCOPES,
    tokenEndpointAuthentication:
      input.tokenEndpointAuthentication ?? 'client_secret_post',
  };
}

function parseProvider(
  raw: unknown,
  index: number,
  warnings: string[]
): ParsedSsoProvider {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`SSO provider item at index ${index} must be an object`);
  }

  const input = raw as Record<string, unknown>;
  const parsedMode: BridgeMode =
    input.mode === 'native' || input.mode === 'cas-bridge'
      ? input.mode
      : 'native';

  const provider: EnvSsoProvider = {
    providerId: ensureString(input.providerId, 'providerId'),
    domain: ensureString(input.domain, 'domain'),
    issuer: ensureString(input.issuer, 'issuer'),
    clientId: ensureString(input.clientId, 'clientId'),
    clientSecret: ensureString(input.clientSecret, 'clientSecret'),
    discoveryEndpoint:
      typeof input.discoveryEndpoint === 'string'
        ? input.discoveryEndpoint
        : undefined,
    tokenEndpointAuthentication:
      input.tokenEndpointAuthentication === 'client_secret_basic' ||
      input.tokenEndpointAuthentication === 'client_secret_post'
        ? input.tokenEndpointAuthentication
        : undefined,
    scopes: Array.isArray(input.scopes)
      ? input.scopes.filter(
          scope => typeof scope === 'string' && scope.trim().length > 0
        )
      : undefined,
    pkce: typeof input.pkce === 'boolean' ? input.pkce : undefined,
    mode: parsedMode,
    casIssuer:
      typeof input.casIssuer === 'string' ? input.casIssuer : undefined,
  };

  if (parsedMode === 'cas-bridge' && !provider.casIssuer) {
    warnings.push(
      `[better-auth] provider "${provider.providerId}" is cas-bridge but casIssuer is missing`
    );
  }

  return {
    providerId: provider.providerId,
    domain: provider.domain,
    mode: parsedMode,
    casIssuer: provider.casIssuer,
    oidcConfig: toOidcConfig(provider),
  };
}

export function parseSsoProvidersFromEnv(envValue: string | undefined): {
  providers: ParsedSsoProvider[];
  warnings: string[];
} {
  if (!envValue || envValue.trim().length === 0) {
    return { providers: [], warnings: [] };
  }

  let rawList: unknown;
  try {
    rawList = JSON.parse(envValue);
  } catch (error) {
    throw new Error(
      `Invalid BETTER_AUTH_SSO_PROVIDERS_JSON: ${error instanceof Error ? error.message : 'JSON parse failed'}`
    );
  }

  if (!Array.isArray(rawList)) {
    throw new Error('BETTER_AUTH_SSO_PROVIDERS_JSON must be a JSON array');
  }

  const warnings: string[] = [];
  const providers = rawList.map((item, index) =>
    parseProvider(item, index, warnings)
  );

  return { providers, warnings };
}

export function toDefaultSsoConfig(
  providers: ParsedSsoProvider[]
): NonNullable<SSOOptions['defaultSSO']> {
  return providers.map(provider => ({
    domain: provider.domain,
    providerId: provider.providerId,
    oidcConfig: provider.oidcConfig,
  }));
}
