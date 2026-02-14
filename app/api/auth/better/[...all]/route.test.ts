/** @jest-environment node */
import {
  evaluateLocalLoginByEmail,
  extractClientIp,
  parseSignInEmailFromRequest,
  recordLocalLoginAudit,
} from '@lib/auth/better-auth/local-login-policy';

const mockedHandlerPost = jest.fn();

jest.mock('@lib/auth/better-auth/server', () => ({
  auth: {},
}));

jest.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({
    GET: jest.fn(),
    POST: mockedHandlerPost,
    PATCH: jest.fn(),
    PUT: jest.fn(),
    DELETE: jest.fn(),
  }),
}));

jest.mock('@lib/auth/better-auth/local-login-policy', () => ({
  evaluateLocalLoginByEmail: jest.fn(),
  extractClientIp: jest.fn(),
  parseSignInEmailFromRequest: jest.fn(),
  recordLocalLoginAudit: jest.fn(),
}));

describe('POST /api/auth/better/[...all]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (extractClientIp as jest.Mock).mockReturnValue('127.0.0.1');
    (parseSignInEmailFromRequest as jest.Mock).mockReturnValue(
      'user@example.com'
    );
    mockedHandlerPost.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
  });

  it('passes through non email-sign-in routes', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      new Request('http://localhost/api/auth/better/sign-in/sso', {
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    expect(mockedHandlerPost).toHaveBeenCalledTimes(1);
    expect(evaluateLocalLoginByEmail).not.toHaveBeenCalled();
  });

  it('blocks email login when policy denies access', async () => {
    const { POST } = await import('./route');

    (evaluateLocalLoginByEmail as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        allowed: false,
        authMode: 'normal',
        email: 'user@example.com',
        userId: '00000000-0000-4000-8000-000000000001',
        reason: 'blocked_auth_mode',
      },
    });

    const response = await POST(
      new Request('http://localhost/api/auth/better/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: 'user@example.com', password: 'x' }),
      })
    );

    expect(response.status).toBe(403);
    expect(mockedHandlerPost).not.toHaveBeenCalled();
    expect(recordLocalLoginAudit).toHaveBeenCalledTimes(1);
  });

  it('audits failed credentials when policy allows but handler fails', async () => {
    const { POST } = await import('./route');

    (evaluateLocalLoginByEmail as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        allowed: true,
        authMode: 'degraded',
        email: 'user@example.com',
        userId: '00000000-0000-4000-8000-000000000001',
        reason: 'allowed_degraded',
      },
    });

    mockedHandlerPost.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'INVALID_CREDENTIALS' }), {
        status: 401,
      })
    );

    const response = await POST(
      new Request('http://localhost/api/auth/better/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: 'user@example.com', password: 'x' }),
      })
    );

    expect(response.status).toBe(401);
    expect(mockedHandlerPost).toHaveBeenCalledTimes(1);
    expect(recordLocalLoginAudit).toHaveBeenCalledTimes(1);
    expect((recordLocalLoginAudit as jest.Mock).mock.calls[0][0]).toMatchObject(
      {
        outcome: 'failed',
        authMode: 'degraded',
      }
    );
  });
});
