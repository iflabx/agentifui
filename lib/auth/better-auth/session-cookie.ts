import { getCookies } from 'better-auth/cookies';

function upperCaseSameSite(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function serializeCookie(
  key: string,
  value: string,
  options: Record<string, unknown>
): string {
  const prefix =
    options.prefix === 'secure' || options.prefix === 'host'
      ? options.prefix
      : null;

  let name = key;
  if (prefix === 'secure') {
    name = `__Secure-${key}`;
  } else if (prefix === 'host') {
    name = `__Host-${key}`;
  }

  let cookie = `${name}=${value}`;
  const maxAge = options.maxAge;
  const domain = options.domain;
  const path = options.path;
  const expires = options.expires;
  const httpOnly = options.httpOnly;
  const secure = options.secure || prefix === 'secure' || prefix === 'host';
  const sameSite = options.sameSite;
  const partitioned = options.partitioned;

  if (typeof maxAge === 'number' && Number.isFinite(maxAge) && maxAge >= 0) {
    cookie += `; Max-Age=${Math.floor(maxAge)}`;
  }
  if (typeof domain === 'string' && domain && prefix !== 'host') {
    cookie += `; Domain=${domain}`;
  }
  cookie += `; Path=${prefix === 'host' ? '/' : typeof path === 'string' && path ? path : '/'}`;
  if (expires instanceof Date) {
    cookie += `; Expires=${expires.toUTCString()}`;
  }
  if (httpOnly) {
    cookie += '; HttpOnly';
  }
  if (secure) {
    cookie += '; Secure';
  }
  if (typeof sameSite === 'string' && sameSite) {
    cookie += `; SameSite=${upperCaseSameSite(sameSite)}`;
  }
  if (partitioned) {
    cookie += '; Partitioned';
  }

  return cookie;
}

async function signCookieValue(value: string, secret: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(value)
  );

  const encodedSignature = Buffer.from(signature).toString('base64');
  return encodeURIComponent(`${value}.${encodedSignature}`);
}

export async function createSignedSessionTokenCookie(input: {
  authOptions: Parameters<typeof getCookies>[0];
  secret: string;
  token: string;
  rememberMe?: boolean;
  sessionExpiresIn?: number;
}): Promise<string> {
  const sessionToken = getCookies(input.authOptions).sessionToken;
  const attributes = {
    ...sessionToken.attributes,
    ...(input.rememberMe === false
      ? {}
      : {
          maxAge: input.sessionExpiresIn,
        }),
  } as Record<string, unknown>;

  const signedValue = await signCookieValue(input.token, input.secret);
  return serializeCookie(sessionToken.name, signedValue, attributes);
}

export function extractCookiePair(rawSetCookie: string): string | null {
  const firstSegment = rawSetCookie.split(';', 1)[0]?.trim();
  return firstSegment && firstSegment.includes('=') ? firstSegment : null;
}

export function mergeCookieHeader(
  existingCookieHeader: string | null,
  cookiePairs: string[]
): string | null {
  const cookies = new Map<string, string>();

  const addPair = (pair: string) => {
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) {
      return;
    }
    const name = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (!name) {
      return;
    }
    cookies.set(name, value);
  };

  if (existingCookieHeader) {
    for (const fragment of existingCookieHeader.split(';')) {
      const pair = fragment.trim();
      if (pair) {
        addPair(pair);
      }
    }
  }

  for (const pair of cookiePairs) {
    addPair(pair);
  }

  if (cookies.size === 0) {
    return existingCookieHeader;
  }

  return Array.from(cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}
