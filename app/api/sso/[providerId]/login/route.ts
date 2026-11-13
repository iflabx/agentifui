import {
  buildManagedCasLoginUrl,
  toManagedCasProviderConfig,
} from '@lib/auth/managed-sso';
import { getManagedSsoPublicOrigin } from '@lib/auth/managed-sso-origin';
import { getSafeManagedSsoReturnUrl } from '@lib/auth/managed-sso-return-url';
import { getManagedSsoProviderForLoginById } from '@lib/auth/managed-sso-server';

import { NextRequest, NextResponse } from 'next/server';

function buildServiceUrl(
  request: NextRequest,
  providerId: string,
  returnUrl: string
): string {
  const serviceUrl = new URL(
    `/api/sso/${providerId}/callback`,
    getManagedSsoPublicOrigin(request)
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
  const redirectUrl = new URL('/login', getManagedSsoPublicOrigin(request));
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
  const returnUrl = getSafeManagedSsoReturnUrl(
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
