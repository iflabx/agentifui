/** @jest-environment node */
import { auth } from '@lib/auth/better-auth/server';
import { getSafeManagedSsoReturnUrl } from '@lib/auth/managed-sso-return-url';
import { getManagedSsoProviderForLoginById } from '@lib/auth/managed-sso-server';
import type { SsoProvider } from '@lib/types/database';

import { NextRequest } from 'next/server';

import { GET as callback } from '../../app/api/sso/[providerId]/callback/route';
import { GET as login } from '../../app/api/sso/[providerId]/login/route';
import { GET as logout } from '../../app/api/sso/[providerId]/logout/route';

jest.mock('@lib/auth/better-auth/server', () => ({
  auth: { api: { signOut: jest.fn() } },
}));
jest.mock('@lib/auth/managed-sso-server', () => ({
  getManagedSsoProviderForLoginById: jest.fn(),
}));
jest.mock('@lib/auth/better-auth/session-cookie', () => ({
  createSignedSessionTokenCookie: jest.fn(),
  extractCookiePair: jest.fn(),
  mergeCookieHeader: jest.fn(),
}));
jest.mock('@lib/auth/better-auth/session-identity', () => ({
  syncSessionIdentitySideEffects: jest.fn(),
}));
jest.mock('@lib/db/user-identities', () => ({
  upsertProfileExternalAttributes: jest.fn(),
}));
jest.mock('@lib/db/users', () => ({ updateUserProfile: jest.fn() }));
jest.mock('@lib/server/pg/user-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
}));

const APP_ORIGIN = 'https://app.example.com';
const PROVIDER_ID = '11111111-1111-4111-8111-111111111111';
const allowedCases: [string, string][] = [
  ['/', '/'],
  ['/chat', '/chat'],
  ['/chat/conversations/123', '/chat/conversations/123'],
  [
    '/chat?query=hello%20world&sort=recent#message-2',
    '/chat?query=hello%20world&sort=recent#message-2',
  ],
  ['/login?callback=%2Fchat#continue', '/login?callback=%2Fchat#continue'],
  [
    '/chat?next=https://evil.example/path',
    '/chat?next=https://evil.example/path',
  ],
  ['/chat?next=//evil.example', '/chat?next=//evil.example'],
  ['/chat#//evil.example', '/chat#//evil.example'],
  ['/a//b', '/a//b'],
  ['/a/../chat?view=history#latest', '/chat?view=history#latest'],
  ['/a/./b', '/a/b'],
  ['/a/%2e%2e/chat', '/chat'],
  ['/%2F%2Fevil.example', '/%2F%2Fevil.example'],
  ['/%5Cevil.example', '/%5Cevil.example'],
];
const rejectedCases: (string | null)[] = [
  null,
  '',
  'chat',
  '../chat',
  '?next=/chat',
  '#chat',
  ' /chat',
  'https://evil.example/chat',
  `${APP_ORIGIN}/chat`,
  'https://managed-sso.invalid/chat',
  'http://evil.example',
  'javascript:alert(1)',
  'data:text/html,example',
  '//evil.example',
  '///evil.example/chat',
  '//app.example.com/chat',
  '//user:password@evil.example',
  '/\\evil.example',
  '/chat\\..\\evil.example',
  '/chat?next=\\evil.example',
  '/chat#\\evil.example',
  '/a/..//evil.example',
  '/a/%2e%2e//evil.example',
  '/a/.%2e//evil.example',
  '/a/%2e.//evil.example',
  '/%2e%2e//evil.example',
];
const asciiControls = [...Array.from({ length: 32 }, (_, code) => code), 127];

describe('getSafeManagedSsoReturnUrl', () => {
  it.each(allowedCases)(
    'canonicalizes a local URL %j to %j',
    (value, expected) => {
      expect(getSafeManagedSsoReturnUrl(value)).toBe(expected);
      expect(getSafeManagedSsoReturnUrl(value, '/login')).toBe(expected);
    }
  );

  it.each(rejectedCases)('rejects unsafe or non-local input %j', value => {
    expect(getSafeManagedSsoReturnUrl(value)).toBe('/chat');
    expect(getSafeManagedSsoReturnUrl(value, '/login')).toBe('/login');
  });

  it.each(asciiControls)(
    'rejects ASCII control code %i anywhere in the URL',
    code => {
      const control = String.fromCharCode(code);
      for (const value of [
        `${control}/chat`,
        `/chat${control}/next`,
        `/chat?query=a${control}b`,
        `/chat#anchor${control}next`,
      ]) {
        expect(getSafeManagedSsoReturnUrl(value)).toBe('/chat');
        expect(getSafeManagedSsoReturnUrl(value, '/login')).toBe('/login');
      }
    }
  );

  it('rejects a normalized authority-like pathname even when the first parse keeps its origin', () => {
    const value = '/a/..//evil.example';
    const parsed = new URL(value, 'https://managed-sso.invalid');
    expect(parsed.origin).toBe('https://managed-sso.invalid');
    expect(parsed.pathname).toBe('//evil.example');
    expect(new URL(parsed.pathname, APP_ORIGIN).origin).toBe(
      'https://evil.example'
    );
    expect(getSafeManagedSsoReturnUrl(value)).toBe('/chat');
  });

  it('always returns an idempotent same-origin reference against the production origin', () => {
    const inputs = [
      ...allowedCases.map(([value]) => value),
      ...rejectedCases,
      ...asciiControls.map(code => `/chat${String.fromCharCode(code)}next`),
    ];
    for (const fallback of ['/chat', '/login'] as const) {
      for (const input of inputs) {
        const safe = getSafeManagedSsoReturnUrl(input, fallback);
        const resolved = new URL(safe, `${APP_ORIGIN}/api/sso/provider/logout`);
        expect(resolved.origin).toBe(APP_ORIGIN);
        expect(resolved.username).toBe('');
        expect(resolved.password).toBe('');
        expect(safe.startsWith('/')).toBe(true);
        expect(safe.startsWith('//')).toBe(false);
        expect(safe).not.toMatch(/[\\\u0000-\u001f\u007f]/);
        expect(getSafeManagedSsoReturnUrl(safe, fallback)).toBe(safe);
      }
    }
  });
});

function createCasProvider(): SsoProvider {
  return {
    id: PROVIDER_ID,
    name: 'Test CAS',
    protocol: 'CAS',
    settings: {
      protocol_config: {
        base_url: 'https://idp.example.invalid',
        endpoints: {
          login: '/login',
          logout: '/logout',
          validate: '/serviceValidate',
        },
        attributes_mapping: {
          employee_id: 'cas:user',
          username: 'cas:user',
          full_name: 'cas:name',
        },
      },
      security: { require_https: true, validate_certificates: true },
      ui: {},
    },
    client_id: null,
    client_secret: null,
    metadata_url: null,
    enabled: true,
    display_order: 0,
    button_text: 'Test CAS',
    created_at: '2026-11-13T00:00:00.000Z',
    updated_at: '2026-11-13T00:00:00.000Z',
  };
}

function routeRequest(route: string, returnUrl: string | null): NextRequest {
  const url = new URL(`/api/sso/${PROVIDER_ID}/${route}`, APP_ORIGIN);
  if (returnUrl !== null) url.searchParams.set('returnUrl', returnUrl);
  return new NextRequest(url);
}

function routeParams() {
  return { params: Promise.resolve({ providerId: PROVIDER_ID }) };
}

describe('managed CAS return URL route wiring', () => {
  const originalAuthUrl = process.env.BETTER_AUTH_URL;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const routeCases: [string | null, string, string][] = [
    [
      '/chat?view=history#message-2',
      '/chat?view=history#message-2',
      '/chat?view=history#message-2',
    ],
    [
      '/a/../chat?view=history#latest',
      '/chat?view=history#latest',
      '/chat?view=history#latest',
    ],
    [null, '/chat', '/login'],
    ['', '/chat', '/login'],
    ['//evil.example', '/chat', '/login'],
    ['/a/..//evil.example', '/chat', '/login'],
    ['/a/%2e%2e//evil.example', '/chat', '/login'],
    ['/\\evil.example', '/chat', '/login'],
    ['/chat\r\nLocation: https://evil.example', '/chat', '/login'],
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BETTER_AUTH_URL = APP_ORIGIN;
    process.env.NEXT_PUBLIC_APP_URL = APP_ORIGIN;
    (getManagedSsoProviderForLoginById as jest.Mock).mockResolvedValue(
      createCasProvider()
    );
    (auth.api.signOut as unknown as jest.Mock).mockResolvedValue(
      new Response(null, {
        headers: {
          'set-cookie': 'test-session=; Path=/; Max-Age=0; HttpOnly',
        },
      })
    );
    (global.fetch as jest.Mock).mockRejectedValue(
      new Error('Unexpected external request in route test')
    );
  });

  afterEach(() => {
    if (originalAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = originalAuthUrl;
    if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(routeCases)(
    'sanitizes login service and missing-ticket callback for %j',
    async (value, expected) => {
      const loginResponse = await login(
        routeRequest('login', value),
        routeParams()
      );
      expect(loginResponse.status).toBe(307);
      const idp = new URL(loginResponse.headers.get('location')!);
      expect(idp.origin).toBe('https://idp.example.invalid');
      const service = new URL(idp.searchParams.get('service')!);
      expect(service.origin).toBe(APP_ORIGIN);
      expect(service.pathname).toBe(`/api/sso/${PROVIDER_ID}/callback`);
      expect(service.hash).toBe('');
      expect(service.searchParams.get('returnUrl')).toBe(expected);

      const callbackResponse = await callback(
        new NextRequest(service),
        routeParams()
      );
      expect(callbackResponse.status).toBe(307);
      const errorRedirect = new URL(callbackResponse.headers.get('location')!);
      expect(errorRedirect.origin).toBe(APP_ORIGIN);
      expect(errorRedirect.pathname).toBe('/login');
      expect(errorRedirect.searchParams.get('error')).toBe('missing_ticket');
      expect(errorRedirect.searchParams.get('provider')).toBe(PROVIDER_ID);
      expect(errorRedirect.searchParams.get('callback')).toBe(expected);
      expect(getManagedSsoProviderForLoginById).toHaveBeenCalledTimes(1);
      expect(getManagedSsoProviderForLoginById).toHaveBeenCalledWith(
        PROVIDER_ID
      );
      expect(auth.api.signOut).not.toHaveBeenCalled();
    }
  );

  it.each(routeCases)(
    'sanitizes a direct missing-ticket callback for %j',
    async (value, expected) => {
      const response = await callback(
        routeRequest('callback', value),
        routeParams()
      );
      const destination = new URL(response.headers.get('location')!);
      expect(response.status).toBe(307);
      expect(destination.origin).toBe(APP_ORIGIN);
      expect(destination.pathname).toBe('/login');
      expect(destination.searchParams.get('error')).toBe('missing_ticket');
      expect(destination.searchParams.get('callback')).toBe(expected);
      expect(getManagedSsoProviderForLoginById).not.toHaveBeenCalled();
      expect(auth.api.signOut).not.toHaveBeenCalled();
    }
  );

  it.each(routeCases)(
    'keeps logout local and preserves cookie clearing for %j',
    async (value, _loginExpected, expected) => {
      const request = routeRequest('logout', value);
      const response = await logout(request, routeParams());
      const destination = new URL(response.headers.get('location')!);
      expect(response.status).toBe(307);
      expect(destination.origin).toBe(APP_ORIGIN);
      expect(
        `${destination.pathname}${destination.search}${destination.hash}`
      ).toBe(expected);
      expect(response.headers.get('x-legacy-provider')).toBe(PROVIDER_ID);
      expect(response.headers.get('set-cookie')).toContain('test-session=;');
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
      expect(auth.api.signOut).toHaveBeenCalledTimes(1);
      expect(auth.api.signOut).toHaveBeenCalledWith({
        headers: request.headers,
        asResponse: true,
      });
      expect(getManagedSsoProviderForLoginById).not.toHaveBeenCalled();
    }
  );

  it.each(['BETTER_AUTH_URL', 'NEXT_PUBLIC_APP_URL'] as const)(
    'uses configured %s for logout when the request URL has an internal origin',
    async originSetting => {
      delete process.env.BETTER_AUTH_URL;
      delete process.env.NEXT_PUBLIC_APP_URL;
      process.env[originSetting] = APP_ORIGIN;
      const url = new URL(
        `/api/sso/${PROVIDER_ID}/logout`,
        'https://localhost:3000'
      );
      url.searchParams.set('returnUrl', '/chat?view=history#latest');
      const request = new NextRequest(url);
      expect(new URL(request.url).origin).toBe('https://localhost:3000');

      const response = await logout(request, routeParams());
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        `${APP_ORIGIN}/chat?view=history#latest`
      );
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
      expect(auth.api.signOut).toHaveBeenCalledWith({
        headers: request.headers,
        asResponse: true,
      });
    }
  );
});
