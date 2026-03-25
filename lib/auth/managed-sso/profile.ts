import { readString, stripNamespace } from './helpers';
import {
  ManagedCasProviderConfig,
  ParsedCasServiceResponse,
  ResolvedManagedCasProfile,
} from './types';

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
