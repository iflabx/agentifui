/** @jest-environment node */
import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { recordErrorEvent } from '@lib/server/errors/error-events';
import { requireAdmin } from '@lib/services/admin/require-admin';

jest.mock('@lib/auth/better-auth/session-identity', () => ({
  resolveSessionIdentity: jest.fn(),
}));

jest.mock('@lib/server/errors/error-events', () => ({
  recordErrorEvent: jest.fn().mockResolvedValue(undefined),
}));

describe('requireAdmin', () => {
  const mockedResolveSessionIdentity =
    resolveSessionIdentity as jest.MockedFunction<
      typeof resolveSessionIdentity
    >;
  const mockedRecordErrorEvent = recordErrorEvent as jest.MockedFunction<
    typeof recordErrorEvent
  >;

  const headers = new Headers();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockedResolveSessionIdentity.mockResolvedValueOnce({
      success: true,
      data: null,
    });

    const result = await requireAdmin(headers);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected auth failure result');
    expect(result.response.status).toBe(401);
    expect(mockedRecordErrorEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AUTH_UNAUTHORIZED',
        httpStatus: 401,
        source: 'auth',
      })
    );
  });

  it('returns 500 when session identity resolve fails', async () => {
    mockedResolveSessionIdentity.mockResolvedValueOnce({
      success: false,
      error: new Error('resolve failed'),
    });

    const result = await requireAdmin(headers);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected auth failure result');
    expect(result.response.status).toBe(500);
    expect(mockedRecordErrorEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AUTH_VERIFY_FAILED',
        httpStatus: 500,
        source: 'auth',
      })
    );
  });

  it('returns 403 when user role is not admin', async () => {
    mockedResolveSessionIdentity.mockResolvedValueOnce({
      success: true,
      data: {
        session: {
          session: {
            id: 'session-id',
            userId: 'user-1',
          },
          user: {
            id: 'user-1',
          },
        } as never,
        authUserId: 'user-1',
        userId: '00000000-0000-4000-8000-000000000001',
        role: 'user',
        status: 'active',
      },
    });

    const result = await requireAdmin(headers);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected auth failure result');
    expect(result.response.status).toBe(403);
    expect(mockedRecordErrorEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AUTH_FORBIDDEN',
        httpStatus: 403,
        source: 'auth',
      })
    );
  });

  it('returns ok=true with userId for admin', async () => {
    mockedResolveSessionIdentity.mockResolvedValueOnce({
      success: true,
      data: {
        session: {
          session: {
            id: 'session-id',
            userId: 'admin-1',
          },
          user: {
            id: 'admin-1',
          },
        } as never,
        authUserId: 'admin-1',
        userId: '00000000-0000-4000-8000-000000000002',
        role: 'admin',
        status: 'active',
      },
    });

    const result = await requireAdmin(headers);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected auth success result');
    expect(result.userId).toBe('00000000-0000-4000-8000-000000000002');
    expect(mockedRecordErrorEvent).not.toHaveBeenCalled();
  });
});
