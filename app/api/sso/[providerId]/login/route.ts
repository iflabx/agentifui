import {
  buildManagedCasLoginUrl,
  toManagedCasProviderConfig,
} from '@lib/auth/managed-sso';
import { getManagedSsoProviderForLoginById } from '@lib/auth/managed-sso-server';

import { NextRequest, NextResponse } from 'next/server';

function getSafeReturnUrl(value: string | null): string {
  return typeof value === 'string' && value.startsWith('/') ? value : '/chat';
}

function getPublicOrigin(request: NextRequest): string {
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

function buildServiceUrl(
  request: NextRequest,
  providerId: string,
  returnUrl: string
): string {
  const serviceUrl = new URL(
    `/api/sso/${providerId}/callback`,
    getPublicOrigin(request)
  );
  serviceUrl.search = '';
  serviceUrl.searchParams.set('returnUrl', returnUrl);
  return serviceUrl.toString();
}

function redirectToLoginError(
  request: NextRequest,
  providerId: string,
  returnUrl: string,
  errorCode: string
) {
  const redirectUrl = new URL('/login', getPublicOrigin(request));
  redirectUrl.searchParams.set('error', errorCode);
  redirectUrl.searchParams.set('provider', providerId);
  redirectUrl.searchParams.set('callback', returnUrl);
  return NextResponse.redirect(redirectUrl);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  const { providerId } = await params;
  const returnUrl = getSafeReturnUrl(
    request.nextUrl.searchParams.get('returnUrl')
  );

  const provider = await getManagedSsoProviderForLoginById(providerId);
  if (!provider) {
    return redirectToLoginError(
      request,
      providerId,
      returnUrl,
      'sso_provider_not_found'
    );
  }

  const providerConfig = toManagedCasProviderConfig(provider);
  if (!providerConfig) {
    return redirectToLoginError(
      request,
      providerId,
      returnUrl,
      'sso_provider_not_found'
    );
  }

  return NextResponse.redirect(
    buildManagedCasLoginUrl(
      providerConfig,
      buildServiceUrl(request, providerId, returnUrl)
    )
  );
}
