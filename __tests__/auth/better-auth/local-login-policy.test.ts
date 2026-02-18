/** @jest-environment node */
import {
  evaluateLocalLoginByEmail,
  extractClientIp,
  getAuthModeSetting,
  getUserLocalLoginStateByUserId,
  parseSignInEmailFromRequest,
  recordLocalLoginAudit,
  setAuthModeSetting,
  setUserLocalLoginEnabledByUserId,
} from '@lib/auth/better-auth/local-login-policy';
import {
  queryRowsWithPgSystemContext,
  queryRowsWithPgUserContext,
} from '@lib/server/pg/user-context';

jest.mock('@lib/server/pg/user-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
  queryRowsWithPgUserContext: jest.fn(),
}));

describe('local-login-policy', () => {
  const queryMock = jest.fn();
  const mockedQueryRowsWithPgSystemContext =
    queryRowsWithPgSystemContext as jest.MockedFunction<
      typeof queryRowsWithPgSystemContext
    >;
  const mockedQueryRowsWithPgUserContext =
    queryRowsWithPgUserContext as jest.MockedFunction<
      typeof queryRowsWithPgUserContext
    >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedQueryRowsWithPgSystemContext.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        const result = await queryMock(sql, params);
        return result.rows || [];
      }
    );
    mockedQueryRowsWithPgUserContext.mockImplementation(
      async (
        _userId: string | null | undefined,
        sql: string,
        params: unknown[] = []
      ) => {
        const result = await queryMock(sql, params);
        return result.rows || [];
      }
    );
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

  it('reads auth mode setting', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ auth_mode: 'degraded' }] });

    const result = await getAuthModeSetting();

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected success');
    expect(result.data).toBe('degraded');
  });

  it('updates auth mode setting', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ auth_mode: 'degraded' }] });

    const result = await setAuthModeSetting('degraded');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected success');
    expect(result.data).toBe('degraded');
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
      })
      .mockResolvedValueOnce({
        rows: [{ has_credential_password: true }],
      });

    const result = await evaluateLocalLoginByEmail('user@example.com');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected success');
    expect(result.data.allowed).toBe(true);
    expect(result.data.reason).toBe('allowed_degraded');
  });

  it('blocks external-idp account when degraded but fallback password is missing', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ auth_mode: 'degraded' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            auth_source: 'oidc',
            local_login_enabled: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ has_credential_password: false }],
      });

    const result = await evaluateLocalLoginByEmail('user@example.com');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected success');
    expect(result.data.allowed).toBe(false);
    expect(result.data.reason).toBe('missing_fallback_password');
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

  it('treats better-auth account as local password account', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ auth_mode: 'normal' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            auth_source: 'better-auth',
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

  it('allows when auth user exists but profile row is not materialized yet', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ auth_mode: 'normal' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: null,
            auth_source: null,
            local_login_enabled: null,
          },
        ],
      });

    const result = await evaluateLocalLoginByEmail(
      'pending-profile@example.com'
    );

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

  it('gets user local-login state by user id', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'user@example.com',
          auth_source: 'oidc',
          local_login_enabled: true,
          local_login_updated_at: '2026-02-14T00:00:00.000Z',
          fallback_password_set_at: '2026-02-14T01:00:00.000Z',
          fallback_password_updated_by: '00000000-0000-4000-8000-000000000009',
        },
      ],
    });

    const result = await getUserLocalLoginStateByUserId(
      '00000000-0000-4000-8000-000000000001'
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected success');
    expect(result.data).toMatchObject({
      userId: '00000000-0000-4000-8000-000000000001',
      localLoginEnabled: true,
      authSource: 'oidc',
      fallbackPasswordSetAt: '2026-02-14T01:00:00.000Z',
      fallbackPasswordUpdatedBy: '00000000-0000-4000-8000-000000000009',
    });
  });

  it('updates user local-login state by user id', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            email: 'user@example.com',
            auth_source: 'oidc',
            local_login_enabled: true,
            local_login_updated_at: '2026-02-13T00:00:00.000Z',
            fallback_password_set_at: '2026-02-14T02:00:00.000Z',
            fallback_password_updated_by:
              '00000000-0000-4000-8000-000000000009',
            updated_at: '2026-02-14T03:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            email: 'user@example.com',
            auth_source: 'oidc',
            local_login_enabled: false,
            local_login_updated_at: '2026-02-14T00:00:00.000Z',
            fallback_password_set_at: '2026-02-14T02:00:00.000Z',
            fallback_password_updated_by:
              '00000000-0000-4000-8000-000000000009',
            updated_at: '2026-02-14T03:10:00.000Z',
          },
        ],
      });

    const result = await setUserLocalLoginEnabledByUserId(
      '00000000-0000-4000-8000-000000000001',
      false
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected success');
    expect(result.data).toMatchObject({
      userId: '00000000-0000-4000-8000-000000000001',
      localLoginEnabled: false,
      fallbackPasswordSetAt: '2026-02-14T02:00:00.000Z',
      fallbackPasswordUpdatedBy: '00000000-0000-4000-8000-000000000009',
    });
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
