import { SECURITY_CONFIG } from './config';

export function sanitizeProfileText(
  text: string | null | undefined,
  maxLength: number = 255
): string | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const trimmed = text.trim();

  if (trimmed === '') {
    return null;
  }

  if (trimmed.length > maxLength) {
    console.warn(
      `[Security] Profile text too long: ${trimmed.length}/${maxLength} chars`
    );
    return trimmed.substring(0, maxLength);
  }

  for (const pattern of SECURITY_CONFIG.DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.warn(`[Security] Blocked dangerous pattern in profile text`);
      return null;
    }
  }

  const dangerousChars = /[\u0000-\u001f\u007f-\u009f]/g;
  if (dangerousChars.test(trimmed)) {
    console.warn(
      `[Security] Removed dangerous control characters from profile text`
    );
    return trimmed.replace(dangerousChars, '');
  }

  return trimmed;
}
