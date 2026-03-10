import { getPublicSsoProviders } from '@lib/auth/better-auth/server';
import {
  PublicLoginSsoProvider,
  toPublicManagedSsoProvider,
} from '@lib/auth/managed-sso';
import { listManagedSsoProvidersForLogin } from '@lib/auth/managed-sso-server';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';

import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const managedProviders = (await listManagedSsoProvidersForLogin())
      .map(toPublicManagedSsoProvider)
      .filter(
        (provider): provider is PublicLoginSsoProvider => provider !== null
      );

    const runtimeProviders: PublicLoginSsoProvider[] =
      getPublicSsoProviders().map(provider => ({
        ...provider,
        authFlow: 'better-auth',
      }));

    return NextResponse.json({
      providers: [...managedProviders, ...runtimeProviders],
      success: true,
    });
  } catch (error) {
    console.error('[AuthSSOProviders] failed to load providers:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'auth',
      code: 'AUTH_SSO_PROVIDERS_LOAD_FAILED',
      userMessage: 'Failed to load providers',
      developerMessage:
        error instanceof Error ? error.message : 'Unknown providers load error',
      extra: {
        providers: [],
      },
    });
  }
}
