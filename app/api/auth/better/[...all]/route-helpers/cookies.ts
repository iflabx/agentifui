import type { HeadersWithGetSetCookie } from './types';

function splitSetCookieHeader(header: string): string[] {
  const values: string[] = [];
  let start = 0;
  let inExpires = false;
  for (let i = 0; i < header.length; i += 1) {
    const char = header[i];
    if (!inExpires) {
      if (header.slice(i, i + 8).toLowerCase() === 'expires=') {
        inExpires = true;
        i += 7;
        continue;
      }
      if (char === ',') {
        const part = header.slice(start, i).trim();
        if (part) {
          values.push(part);
        }
        start = i + 1;
      }
    } else if (char === ';') {
      inExpires = false;
    }
  }

  const last = header.slice(start).trim();
  if (last) {
    values.push(last);
  }

  return values;
}

export function readSetCookies(headers: Headers): string[] {
  const headersWithGetSetCookie = headers as HeadersWithGetSetCookie;
  const getSetCookie = headersWithGetSetCookie.getSetCookie;
  if (typeof getSetCookie === 'function') {
    const cookies = getSetCookie.call(headersWithGetSetCookie);
    if (Array.isArray(cookies) && cookies.length > 0) {
      return cookies;
    }
  }

  const single = headers.get('set-cookie');
  return single ? splitSetCookieHeader(single) : [];
}

function parseCookiePair(rawCookie: string): {
  name: string;
  value: string;
} | null {
  const firstSegment = rawCookie.split(';', 1)[0]?.trim();
  if (!firstSegment) {
    return null;
  }

  const equalsIndex = firstSegment.indexOf('=');
  if (equalsIndex <= 0) {
    return null;
  }

  const name = firstSegment.slice(0, equalsIndex).trim();
  const value = firstSegment.slice(equalsIndex + 1).trim();
  if (!name) {
    return null;
  }

  return { name, value };
}

export function mergeCookieHeader(
  existingCookieHeader: string | null,
  setCookies: string[]
): string | null {
  const cookieMap = new Map<string, string>();

  const addCookiePair = (cookiePair: string) => {
    const equalsIndex = cookiePair.indexOf('=');
    if (equalsIndex <= 0) {
      return;
    }
    const name = cookiePair.slice(0, equalsIndex).trim();
    const value = cookiePair.slice(equalsIndex + 1).trim();
    if (!name) {
      return;
    }
    cookieMap.set(name, value);
  };

  if (existingCookieHeader) {
    for (const token of existingCookieHeader.split(';')) {
      const trimmed = token.trim();
      if (!trimmed) {
        continue;
      }
      addCookiePair(trimmed);
    }
  }

  for (const rawSetCookie of setCookies) {
    const parsed = parseCookiePair(rawSetCookie);
    if (!parsed) {
      continue;
    }
    cookieMap.set(parsed.name, parsed.value);
  }

  if (cookieMap.size === 0) {
    return existingCookieHeader;
  }

  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}
