/** @jest-environment node */
import { NextRequest } from 'next/server';

import { middleware } from './middleware';

describe('middleware /chat redirects', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('redirects unauthenticated /chat requests to /login', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 401,
      })
    ) as typeof fetch;

    const response = await middleware(new NextRequest('http://localhost/chat'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login');
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
    expect(response.headers.get('location')).toBe('http://localhost/chat/new');
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
    expect(response.headers.get('location')).toBe('http://localhost/login');
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
