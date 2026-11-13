const RETURN_URL_BASE = 'https://managed-sso.invalid';

export function getSafeManagedSsoReturnUrl(
  value: string | null,
  fallback: '/chat' | '/login' = '/chat'
): string {
  if (
    !value?.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const url = new URL(value, RETURN_URL_BASE);
    if (url.origin !== RETURN_URL_BASE || url.pathname.startsWith('//')) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
