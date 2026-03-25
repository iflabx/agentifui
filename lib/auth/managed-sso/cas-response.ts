import { decodeXmlEntities, readString, stripNamespace } from './helpers';
import { ParsedCasServiceResponse } from './types';

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
