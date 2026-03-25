export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

export function normalizePath(value: string | null, fallback: string): string {
  const normalized = readString(value) || fallback;
  if (normalized.startsWith('/')) {
    return normalized;
  }
  return `/${normalized}`;
}

export function normalizeIssuer(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

export function toAccountProviderId(providerId: string): string {
  return `managed-cas:${providerId}`;
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

export function stripNamespace(value: string): string {
  const normalized = value.trim();
  const colonIndex = normalized.indexOf(':');
  return colonIndex >= 0 ? normalized.slice(colonIndex + 1) : normalized;
}
