const CACHE_INVALIDATION_ORIGIN_GLOBAL_KEY =
  '__agentifui_cache_invalidation_origin__';

export function parseBooleanEnv(
  value: string | undefined,
  fallback: boolean
): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function toSeconds(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(ms / 1000));
}

export function toPositiveNumber(
  value: string | undefined,
  fallback: number
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function escapeRegexPattern(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveInvalidationOrigin(): string {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[CACHE_INVALIDATION_ORIGIN_GLOBAL_KEY];
  if (typeof existing === 'string' && existing.length > 0) {
    return existing;
  }
  const created = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  globalState[CACHE_INVALIDATION_ORIGIN_GLOBAL_KEY] = created;
  return created;
}
