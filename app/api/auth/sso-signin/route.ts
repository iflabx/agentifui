import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';

/**
 * Deprecated endpoint.
 * SSO sign-in is now handled by better-auth /api/auth/better/sign-in/sso.
 */
export async function POST(request: Request) {
  return nextApiErrorResponse({
    request,
    status: 410,
    source: 'auth',
    code: 'AUTH_SSO_SIGNIN_DEPRECATED',
    userMessage: 'Deprecated endpoint',
    extra: {
      message: 'Use /api/auth/better/sign-in/sso for SSO authentication flow.',
    },
  });
}
