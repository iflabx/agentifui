/** @jest-environment node */
import { fetchInternalEndpoint } from '@lib/middleware/request-utils';

import type { NextRequest } from 'next/server';

function createRequest(
  url: string,
  headersInit: HeadersInit = {}
): NextRequest {
  return {
    url,
    headers: new Headers(headersInit),
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

describe('middleware request-utils internal origin resolution', () => {
  const originalNextUpstreamBaseUrl = process.env.NEXT_UPSTREAM_BASE_URL;
  const originalBetterAuthUrl = process.env.BETTER_AUTH_URL;
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;

    if (typeof originalNextUpstreamBaseUrl === 'string') {
      process.env.NEXT_UPSTREAM_BASE_URL = originalNextUpstreamBaseUrl;
    } else {
      delete process.env.NEXT_UPSTREAM_BASE_URL;
    }

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

  it('prefers NEXT_UPSTREAM_BASE_URL over the public domain for internal middleware fetches', async () => {
    process.env.NEXT_UPSTREAM_BASE_URL = 'http://127.0.0.1:3000';
    process.env.BETTER_AUTH_URL = 'https://chat.bistu.edu.cn';
    process.env.NEXT_PUBLIC_APP_URL = 'https://chat.bistu.edu.cn';

    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );
    global.fetch = fetchMock as typeof fetch;

    await fetchInternalEndpoint(
      createRequest('https://chat.bistu.edu.cn/chat', {
        host: 'chat.bistu.edu.cn',
        'x-forwarded-host': 'chat.bistu.edu.cn',
        'x-forwarded-proto': 'https',
      }),
      '/api/internal/auth/profile-status',
      {
        method: 'GET',
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:3000/api/internal/auth/profile-status'
    );
  });
});
