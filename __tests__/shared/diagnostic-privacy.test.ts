import {
  safeDiagnosticRoute,
  sanitizeDiagnosticContext,
  sanitizeDiagnosticEvent,
  sanitizeDiagnosticText,
} from '../../packages/shared/src/diagnostic-privacy';

describe('diagnostic privacy', () => {
  it.each([
    'access_token=synthetic-access&refresh_token=synthetic-refresh',
    'client_secret=synthetic-client&session_token=synthetic-session',
    'clientSecret: "synthetic multiword" authToken=synthetic-auth',
    'idToken: synthetic-identity',
    'password="synthetic first second"',
    "secret='synthetic first second'",
    'password="synthetic unterminated value',
    'access_token%3Dsynthetic-access',
    '{"Authorization":"Basic synthetic-credential"}',
    '{"Cookie":"__Secure-better-auth.session_data=synthetic-cookie"}',
    '{"Set-Cookie":"synthetic-session=value; HttpOnly"}',
    "{'authorization': 'Basic synthetic-credential'}",
  ])('redacts complete common credential values: %s', input => {
    expect(sanitizeDiagnosticText(input)).not.toMatch(
      /synthetic|first|second|unterminated/
    );
  });
  it('removes URL credentials, query, fragments and authentication path secrets', () => {
    expect(
      safeDiagnosticRoute(
        'https://user:secret@example.test/reset-password/synthetic-token?callback=hidden#hidden'
      )
    ).toBe('/reset-password/[redacted]');
    expect(safeDiagnosticRoute('/users/person@example.test')).not.toContain(
      '@'
    );
    expect(
      safeDiagnosticRoute('https%3A%2F%2Fexample.test%2Flogin%3Ftoken%3Dhidden')
    ).toBe('/login');
    expect(safeDiagnosticRoute('/reset-password/%bad')).toBe(
      '[redacted-route]'
    );
  });

  it('cleans URL and auth fragments from error text without losing error codes', () => {
    const safe = sanitizeDiagnosticText(
      'HTTP 503 at https://user:secret@example.test/reset-password/hidden?token=hidden#hidden\nBearer hidden\nCookie: session=hidden\ntoken_hash=hidden code=hidden'
    );
    expect(safe).not.toContain('hidden');
    expect(safe).not.toContain('secret');
    expect(safe).toContain('HTTP 503');
  });

  it('uses a bounded scalar allowlist and ignores nested/cyclic business data', () => {
    const circular: Record<string, unknown> = {
      code: 'SAVE_FAILED',
      lineno: 12,
      pathname: '/login?token=hidden',
      request: { token: 'hidden' },
      href: 'hidden',
      prompt: 'hidden',
    };
    circular.self = circular;
    expect(sanitizeDiagnosticContext(circular)).toEqual({
      code: 'SAVE_FAILED',
      lineno: 12,
      pathname: '/login',
    });
  });

  it('sanitizes before persistence and bounds identifiers and messages', () => {
    const safe = sanitizeDiagnosticEvent({
      code: 'SAVE_FAILED',
      userMessage: 'x'.repeat(10000),
      developerMessage: 'token=hidden',
      requestId: 'r'.repeat(500),
      route: '/chat?token=hidden',
      context: { href: 'hidden' },
    });
    expect(safe.userMessage.length).toBeLessThanOrEqual(2000);
    expect(safe.requestId.length).toBeLessThanOrEqual(160);
    expect(safe.route).toBe('/chat');
    expect(JSON.stringify(safe)).not.toContain('hidden');
  });
});
