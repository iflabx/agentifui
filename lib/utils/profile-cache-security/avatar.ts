import { SECURITY_CONFIG } from './config';

export function sanitizeAvatarUrl(
  url: string | null | undefined
): string | null {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return null;
  }

  const trimmedUrl = url.trim();

  if (trimmedUrl.length > SECURITY_CONFIG.MAX_URL_LENGTH) {
    console.warn(`[Security] Avatar URL too long: ${trimmedUrl.length} chars`);
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedUrl);

    if (
      !(SECURITY_CONFIG.ALLOWED_AVATAR_PROTOCOLS as readonly string[]).includes(
        parsedUrl.protocol
      )
    ) {
      console.warn(
        `[Security] Blocked unsafe avatar protocol: ${parsedUrl.protocol}`
      );
      return null;
    }

    for (const pattern of SECURITY_CONFIG.DANGEROUS_PATTERNS) {
      if (pattern.test(trimmedUrl)) {
        console.warn(`[Security] Blocked dangerous pattern in avatar URL`);
        return null;
      }
    }

    if (parsedUrl.protocol === 'data:') {
      const mediaType = trimmedUrl.split(',')[0].toLowerCase();
      if (mediaType.includes('script') || mediaType.includes('html')) {
        console.warn(`[Security] Blocked dangerous data URL type`);
        return null;
      }
    }

    if (
      SECURITY_CONFIG.TRUSTED_AVATAR_HOSTS.length > 0 &&
      !SECURITY_CONFIG.TRUSTED_AVATAR_HOSTS.includes(parsedUrl.host)
    ) {
      console.warn(
        `[Security] Avatar URL from untrusted domain: ${parsedUrl.hostname}`
      );
    }

    return trimmedUrl;
  } catch (error) {
    console.warn(
      `[Security] Invalid avatar URL format: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return null;
  }
}
