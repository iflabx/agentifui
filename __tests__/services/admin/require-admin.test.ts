/** @jest-environment node */
import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { requireAdmin } from '@lib/services/admin/require-admin';

jest.mock('@lib/auth/better-auth/session-identity', () => ({
  resolveSessionIdentity: jest.fn(),
}));

describe('requireAdmin', () => {
  const mockedResolveSessionIdentity =
    resolveSessionIdentity as jest.MockedFunction<
      typeof resolveSessionIdentity
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
  });
});
