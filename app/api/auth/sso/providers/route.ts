import { getPublicSsoProviders } from '@lib/auth/better-auth/server';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';

import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    return NextResponse.json({
      providers: getPublicSsoProviders(),
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
