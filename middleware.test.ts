/** @jest-environment node */
import { NextRequest } from 'next/server';

import { middleware } from './middleware';

describe('middleware /chat redirects', () => {
  const originalFetch = global.fetch;
  const originalBetterAuthUrl = process.env.BETTER_AUTH_URL;
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3000';
    process.env.NEXT_PUBLIC_APP_URL = 'http://127.0.0.1:3000';
  });

  afterEach(() => {
    global.fetch = originalFetch;

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

  it('redirects unauthenticated /chat requests to /login', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 401,
      })
    ) as typeof fetch;

    const response = await middleware(new NextRequest('http://localhost/chat'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://127.0.0.1:3000/login'
    );
  });

  it('redirects authenticated /chat requests to /chat/new after profile validation', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              id: '00000000-0000-4000-8000-000000000010',
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            role: 'user',
            status: 'active',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          }
        )
      ) as typeof fetch;

    const response = await middleware(new NextRequest('http://localhost/chat'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://127.0.0.1:3000/chat/new'
    );
  });

  it('redirects unauthenticated /chat/new requests to /login', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 401,
      })
    ) as typeof fetch;

    const response = await middleware(
      new NextRequest('http://localhost/chat/new')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://127.0.0.1:3000/login'
    );
  });

  it.each([
    'http://localhost/api/internal/data',
    'http://localhost/api/admin/encrypt',
  ])('skips middleware auth proxy checks for %s', async url => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;

    const response = await middleware(new NextRequest(url));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBeNull();
  });
});
