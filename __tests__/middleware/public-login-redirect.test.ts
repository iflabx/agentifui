/** @jest-environment node */
import { getSessionFromAuthApi } from '@lib/middleware/auth-api';

import type { NextRequest } from 'next/server';

import { middleware } from '../../middleware';

jest.mock('@lib/middleware/auth-api', () => ({
  getSessionFromAuthApi: jest.fn(),
  getProfileStatusFromApi: jest.fn(),
  signOutAndRedirect: jest.fn(),
}));

function createRequest(
  url: string,
  headersInit: HeadersInit = {}
): NextRequest {
  return {
    url,
    method: 'GET',
    headers: new Headers(headersInit),
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

describe('middleware unauthenticated redirect origin', () => {
  const originalBetterAuthUrl = process.env.BETTER_AUTH_URL;
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const mockedGetSessionFromAuthApi =
    getSessionFromAuthApi as jest.MockedFunction<typeof getSessionFromAuthApi>;

  afterEach(() => {
    jest.clearAllMocks();

    if (typeof originalBetterAuthUrl === 'string') {
      process.env.BETTER_AUTH_URL = originalBetterAuthUrl;
    } else {
      delete process.env.BETTER_AUTH_URL;
    }

    if (typeof originalNextPublicAppUrl === 'string') {
      process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl;
    } else {
      delete process.env.NEXT_PUBLIC_APP_URL;
    }
  });

  it('redirects protected routes to the public login origin when the request URL is localhost', async () => {
    process.env.BETTER_AUTH_URL = 'https://chat.bistu.edu.cn';
    delete process.env.NEXT_PUBLIC_APP_URL;
    mockedGetSessionFromAuthApi.mockResolvedValueOnce(null);

    const response = await middleware(
      createRequest('https://localhost:3000/chat', {
        host: 'localhost:3000',
        'x-forwarded-host': 'chat.bistu.edu.cn',
        'x-forwarded-proto': 'https',
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://chat.bistu.edu.cn/login'
    );
  });
});
