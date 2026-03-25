import {
  asRecord,
  normalizeIssuer,
  normalizePath,
  readString,
  readStringArray,
  toAccountProviderId,
} from './helpers';
import {
  ManagedCasProviderConfig,
  PublicLoginSsoProvider,
  SsoProvider,
  SsoProviderSettings,
} from './types';

function getSettings(provider: SsoProvider): Record<string, unknown> {
  return asRecord(provider.settings as SsoProviderSettings);
}

function getProtocolConfig(provider: SsoProvider): Record<string, unknown> {
  return asRecord(getSettings(provider).protocol_config);
}

function getSecurityConfig(provider: SsoProvider): Record<string, unknown> {
  return asRecord(getSettings(provider).security);
}

function getUiConfig(provider: SsoProvider): Record<string, unknown> {
  return asRecord(getSettings(provider).ui);
}

function getBaseUrl(provider: SsoProvider): string | null {
  const settings = getSettings(provider);
  const protocolConfig = getProtocolConfig(provider);
  const rawBaseUrl =
    readString(settings.base_url) || readString(protocolConfig.base_url);

  if (!rawBaseUrl) {
    return null;
  }

  try {
    return new URL(rawBaseUrl).toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function getEmailDomain(provider: SsoProvider): string | null {
  const settings = getSettings(provider);
  return readString(settings.email_domain)?.toLowerCase() || null;
}

function getAllowedRedirectHosts(provider: SsoProvider): string[] {
  const security = getSecurityConfig(provider);
  return readStringArray(security.allowed_redirect_hosts).map(host =>
    host.toLowerCase()
  );
}

function getDomain(provider: SsoProvider, baseUrl: string): string {
  const emailDomain = getEmailDomain(provider);
  if (emailDomain) {
    return emailDomain;
  }

  const allowedRedirectHosts = getAllowedRedirectHosts(provider);
  if (allowedRedirectHosts.length > 0) {
    return allowedRedirectHosts[0];
  }

  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return 'sso.local';
  }
}

function getAttributeMapping(provider: SsoProvider): {
  employeeId: string;
  username: string;
  fullName: string;
  email: string;
} {
  const protocolConfig = getProtocolConfig(provider);
  const mappings = asRecord(protocolConfig.attributes_mapping);

  return {
    employeeId: readString(mappings.employee_id) || 'cas:user',
    username: readString(mappings.username) || 'cas:user',
    fullName: readString(mappings.full_name) || 'cas:user',
    email: readString(mappings.email) || 'email',
  };
}

export function toManagedCasProviderConfig(
  provider: SsoProvider
): ManagedCasProviderConfig | null {
  if (provider.protocol !== 'CAS' || !provider.enabled) {
    return null;
  }

  const baseUrl = getBaseUrl(provider);
  if (!baseUrl) {
    return null;
  }

  const settings = getSettings(provider);
  const protocolConfig = getProtocolConfig(provider);
  const endpoints = asRecord(protocolConfig.endpoints);
  const displayName =
    readString(provider.button_text) ||
    readString(provider.name) ||
    'SSO Login';
  const icon = readString(getUiConfig(provider).icon) || '🏛️';

  return {
    id: provider.id,
    providerId: provider.id,
    accountProviderId: toAccountProviderId(provider.id),
    displayName,
    icon,
    description:
      readString(getUiConfig(provider).description) ||
      readString(settings.description) ||
      null,
    domain: getDomain(provider, baseUrl),
    issuer: normalizeIssuer(baseUrl),
    baseUrl,
    loginEndpoint: normalizePath(
      readString(settings.login_endpoint) || readString(endpoints.login),
      '/login'
    ),
    logoutEndpoint: normalizePath(
      readString(settings.logout_endpoint) || readString(endpoints.logout),
      '/logout'
    ),
    validateEndpoint: normalizePath(
      readString(settings.validate_endpoint) || readString(endpoints.validate),
      '/serviceValidate'
    ),
    validateEndpointV3: readString(settings.validate_endpoint_v3)
      ? normalizePath(
          readString(settings.validate_endpoint_v3),
          '/p3/serviceValidate'
        )
      : readString(endpoints.validate_v3)
        ? normalizePath(
            readString(endpoints.validate_v3),
            '/p3/serviceValidate'
          )
        : null,
    emailDomain: getEmailDomain(provider),
    allowedRedirectHosts: getAllowedRedirectHosts(provider),
    attributeMapping: getAttributeMapping(provider),
  };
}

export function toPublicManagedSsoProvider(
  provider: SsoProvider
): PublicLoginSsoProvider | null {
  const config = toManagedCasProviderConfig(provider);
  if (!config) {
    return null;
  }

  return {
    providerId: config.providerId,
    domain: config.domain,
    displayName: config.displayName,
    icon: config.icon,
    mode: 'managed-cas',
    authFlow: 'managed-cas',
    description: config.description,
  };
}
