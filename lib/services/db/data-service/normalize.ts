export function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeValue(item));
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    Object.entries(record).forEach(([key, entryValue]) => {
      normalized[key] = normalizeValue(entryValue);
    });
    return normalized;
  }

  return value;
}

export function normalizeRow<T>(row: unknown): T {
  return normalizeValue(row) as T;
}
