import type { NextRequest } from 'next/server';

export function getManagedSsoPublicOrigin(request: NextRequest): string {
  const envOrigin =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (envOrigin) {
    try {
      return new URL(envOrigin).origin;
    } catch {}
  }

  const forwardedHost =
    request.headers.get('x-forwarded-host') || request.headers.get('host');
  const forwardedProto =
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '');

  if (forwardedHost) {
    return `${forwardedProto || 'http'}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}
