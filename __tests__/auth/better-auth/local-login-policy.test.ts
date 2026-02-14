/** @jest-environment node */
import {
  evaluateLocalLoginByEmail,
  extractClientIp,
  parseSignInEmailFromRequest,
  recordLocalLoginAudit,
} from '@lib/auth/better-auth/local-login-policy';
import { getPgPool } from '@lib/server/pg/pool';

jest.mock('@lib/server/pg/pool', () => ({
  getPgPool: jest.fn(),
}));

describe('local-login-policy', () => {
  const queryMock = jest.fn();
  const mockedGetPgPool = getPgPool as jest.MockedFunction<typeof getPgPool>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetPgPool.mockReturnValue({
      query: queryMock,
    } as unknown as ReturnType<typeof getPgPool>);
  });

  it('blocks external-idp account when auth_mode is normal', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ auth_mode: 'normal' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            auth_source: 'github',
            local_login_enabled: true,
          },
        ],
      });

    const result = await evaluateLocalLoginByEmail('user@example.com');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected success');
    expect(result.data.allowed).toBe(false);
    expect(result.data.reason).toBe('blocked_auth_mode');
  });

  it('blocks external-idp account when per-user fallback toggle is off', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ auth_mode: 'degraded' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            auth_source: 'oidc',
            local_login_enabled: false,
          },
        ],
      });

    const result = await evaluateLocalLoginByEmail('user@example.com');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected success');
    expect(result.data.allowed).toBe(false);
    expect(result.data.reason).toBe('blocked_user_toggle');
  });

  it('allows external-idp account when degraded and per-user toggle is on', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ auth_mode: 'degraded' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            auth_source: 'cas-bridge',
            local_login_enabled: true,
          },
        ],
      });

    const result = await evaluateLocalLoginByEmail('user@example.com');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected success');
    expect(result.data.allowed).toBe(true);
    expect(result.data.reason).toBe('allowed_degraded');
  });

  it('always allows password-native account', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ auth_mode: 'normal' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            auth_source: 'password',
            local_login_enabled: false,
          },
        ],
      });

    const result = await evaluateLocalLoginByEmail('user@example.com');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected success');
    expect(result.data.allowed).toBe(true);
    expect(result.data.reason).toBe('password_account');
  });

  it('allows unknown user and lets credential check continue', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ auth_mode: 'normal' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await evaluateLocalLoginByEmail('missing@example.com');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected success');
    expect(result.data.allowed).toBe(true);
    expect(result.data.reason).toBe('profile_not_found');
  });

  it('records local-login audit row', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    await recordLocalLoginAudit({
      email: 'user@example.com',
      userId: '00000000-0000-4000-8000-000000000001',
      authMode: 'degraded',
      outcome: 'success',
      reason: 'allowed_degraded',
      statusCode: 200,
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0]?.[0])).toContain(
      'auth_local_login_audit_logs'
    );
  });

  it('parses login email and extracts client ip', () => {
    expect(parseSignInEmailFromRequest({ email: ' A@EXAMPLE.COM ' })).toBe(
      'a@example.com'
    );

    const request = new Request(
      'http://localhost/api/auth/better/sign-in/email',
      {
        headers: {
          'x-forwarded-for': '10.0.0.1, 10.0.0.2',
        },
      }
    );

    expect(extractClientIp(request)).toBe('10.0.0.1');
  });
});
