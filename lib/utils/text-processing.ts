/**
 * Text processing utilities for dynamic content
 *
 * Handles reserved content variable replacement in dynamic page content.
 */
import { resolveReservedVariables } from '@lib/config/branding';

const CONTENT_TEXT_PROP_KEYS = new Set([
  'content',
  'text',
  'title',
  'description',
  'caption',
  'alt',
  'prefix',
  'suffix',
  'linkText',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Process text placeholders and replace them with actual values
 *
 * Backward-compatible alias kept for existing call sites.
 *
 * @param text - The text containing placeholders to process
 * @param locale - The active locale
 * @returns Text with placeholders replaced by actual values
 */
export function processTextPlaceholders(
  text: string,
  locale = 'en-US'
): string {
  return resolveContentVariables(text, locale);
}

export function resolveContentVariables(
  text: string,
  locale: string,
  now: Date = new Date()
): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  return resolveReservedVariables(text, locale, now);
}

export function resolveContentVariablesDeep<T>(
  value: T,
  locale: string,
  now: Date = new Date(),
  currentKey?: string
): T {
  if (typeof value === 'string') {
    if (!currentKey || !CONTENT_TEXT_PROP_KEYS.has(currentKey)) {
      return value;
    }

    return resolveContentVariables(value, locale, now) as T;
  }

  if (Array.isArray(value)) {
    return value.map(item =>
      resolveContentVariablesDeep(item, locale, now, currentKey)
    ) as T;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, childValue] of Object.entries(value)) {
    result[key] = resolveContentVariablesDeep(childValue, locale, now, key);
  }

  return result as T;
}
