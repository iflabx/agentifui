import { SsoProvider, SsoProviderSettings } from '@lib/types/database';

export type PublicSsoAuthFlow = 'better-auth' | 'managed-cas';

export interface PublicLoginSsoProvider {
  providerId: string;
  domain: string;
  displayName: string;
  icon: string;
  mode: 'native' | 'cas-bridge' | 'managed-cas';
  authFlow: PublicSsoAuthFlow;
  description?: string | null;
}

export interface ManagedCasProviderConfig {
  id: string;
  providerId: string;
  accountProviderId: string;
  displayName: string;
  icon: string;
  description: string | null;
  domain: string;
  issuer: string;
  baseUrl: string;
  loginEndpoint: string;
  logoutEndpoint: string;
  validateEndpoint: string;
  validateEndpointV3: string | null;
  emailDomain: string | null;
  allowedRedirectHosts: string[];
  attributeMapping: {
    employeeId: string;
    username: string;
    fullName: string;
    email: string;
  };
}

export interface ParsedCasServiceResponse {
  success: boolean;
  user: string | null;
  attributes: Record<string, string | string[]>;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface ResolvedManagedCasProfile {
  subject: string;
  username: string;
  fullName: string;
  email: string | null;
  employeeNumber: string | null;
  rawAttributes: Record<string, string | string[]>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizePath(value: string | null, fallback: string): string {
  const normalized = readString(value) || fallback;
  if (normalized.startsWith('/')) {
    return normalized;
  }
  return `/${normalized}`;
}

function normalizeIssuer(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

function toAccountProviderId(providerId: string): string {
  return `managed-cas:${providerId}`;
}

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

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function stripNamespace(value: string): string {
  const normalized = value.trim();
  const colonIndex = normalized.indexOf(':');
  return colonIndex >= 0 ? normalized.slice(colonIndex + 1) : normalized;
}

function findFirstTagValue(xml: string, tagNames: string[]): string | null {
  for (const tagName of tagNames) {
    const pattern = new RegExp(
      `<(?:[\\w-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tagName}>`,
      'i'
    );
    const match = xml.match(pattern);
    const value = match?.[1];
    if (value) {
      return decodeXmlEntities(value);
    }
  }

  return null;
}

function parseAttributeBlock(xml: string): Record<string, string | string[]> {
  const blockMatch = xml.match(
    /<(?:[\w-]+:)?attributes\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?attributes>/i
  );
  if (!blockMatch?.[1]) {
    return {};
  }

  const attributes: Record<string, string | string[]> = {};
  const attributePattern =
    /<(?:[\w-]+:)?([A-Za-z0-9_-]+)\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?\1>/g;

  for (const match of blockMatch[1].matchAll(attributePattern)) {
    const key = stripNamespace(match[1] || '');
    const value = decodeXmlEntities(match[2] || '');
    if (!key || !value) {
      continue;
    }

    const existing = attributes[key];
    if (existing === undefined) {
      attributes[key] = value;
      continue;
    }

    if (Array.isArray(existing)) {
      existing.push(value);
      continue;
    }

    attributes[key] = [existing, value];
  }

  return attributes;
}

export function parseCasServiceResponse(xml: string): ParsedCasServiceResponse {
  const normalizedXml = xml.trim();
  if (!normalizedXml) {
    return {
      success: false,
      user: null,
      attributes: {},
      failureCode: 'empty_response',
      failureMessage: 'Empty CAS response',
    };
  }

  const failureMatch = normalizedXml.match(
    /<(?:[\w-]+:)?authenticationFailure\b[^>]*code="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?authenticationFailure>/i
  );
  if (failureMatch) {
    return {
      success: false,
      user: null,
      attributes: {},
      failureCode: readString(failureMatch[1]) || 'authentication_failure',
      failureMessage: decodeXmlEntities(failureMatch[2] || ''),
    };
  }

  const hasSuccessBlock = /<(?:[\w-]+:)?authenticationSuccess\b/i.test(
    normalizedXml
  );
  const user = findFirstTagValue(normalizedXml, ['user']);

  if (!hasSuccessBlock || !user) {
    return {
      success: false,
      user: null,
      attributes: {},
      failureCode: 'invalid_response',
      failureMessage: 'CAS response missing authenticationSuccess or user',
    };
  }

  return {
    success: true,
    user,
    attributes: parseAttributeBlock(normalizedXml),
    failureCode: null,
    failureMessage: null,
  };
}

function readAttributeValue(
  attributes: Record<string, string | string[]>,
  key: string
): string | null {
  const direct = attributes[key];
  if (Array.isArray(direct)) {
    return direct.find(item => item.trim().length > 0) || null;
  }
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }

  const normalizedKey = stripNamespace(key).toLowerCase();
  const entry = Object.entries(attributes).find(([candidate]) => {
    return stripNamespace(candidate).toLowerCase() === normalizedKey;
  });

  if (!entry) {
    return null;
  }

  const [, value] = entry;
  if (Array.isArray(value)) {
    return value.find(item => item.trim().length > 0) || null;
  }

  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveCasMappedValue(
  response: ParsedCasServiceResponse,
  mapping: string,
  fallback?: string | null
): string | null {
  const normalizedMapping = readString(mapping);
  if (!normalizedMapping) {
    return fallback || null;
  }

  if (normalizedMapping.toLowerCase() === 'cas:user') {
    return response.user || fallback || null;
  }

  const candidates = [normalizedMapping, stripNamespace(normalizedMapping)];
  for (const candidate of candidates) {
    const value = readAttributeValue(response.attributes, candidate);
    if (value) {
      return value;
    }
  }

  return fallback || null;
}

export function resolveManagedCasProfile(
  config: ManagedCasProviderConfig,
  response: ParsedCasServiceResponse
): ResolvedManagedCasProfile | null {
  if (!response.success || !response.user) {
    return null;
  }

  const subject = resolveCasMappedValue(
    response,
    config.attributeMapping.employeeId,
    response.user
  );
  if (!subject) {
    return null;
  }

  const username =
    resolveCasMappedValue(
      response,
      config.attributeMapping.username,
      subject
    ) || subject;
  const fullName =
    resolveCasMappedValue(
      response,
      config.attributeMapping.fullName,
      username
    ) || username;

  let email = resolveCasMappedValue(
    response,
    config.attributeMapping.email,
    null
  );
  if (!email && config.emailDomain) {
    email = `${subject}@${config.emailDomain}`.toLowerCase();
  }
  if (email && !email.includes('@') && config.emailDomain) {
    email = `${email}@${config.emailDomain}`.toLowerCase();
  }

  return {
    subject,
    username,
    fullName,
    email,
    employeeNumber: subject,
    rawAttributes: {
      ...response.attributes,
      cas_user: response.user,
    },
  };
}

export function buildManagedCasLoginUrl(
  config: ManagedCasProviderConfig,
  serviceUrl: string
): string {
  const loginUrl = new URL(config.loginEndpoint, `${config.baseUrl}/`);
  loginUrl.searchParams.set('service', serviceUrl);
  return loginUrl.toString();
}

export function buildManagedCasValidateUrl(
  config: ManagedCasProviderConfig,
  serviceUrl: string,
  ticket: string
): string {
  const validatePath = config.validateEndpointV3 || config.validateEndpoint;
  const validateUrl = new URL(validatePath, `${config.baseUrl}/`);
  validateUrl.searchParams.set('service', serviceUrl);
  validateUrl.searchParams.set('ticket', ticket);
  return validateUrl.toString();
}
