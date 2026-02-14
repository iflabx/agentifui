/** @jest-environment node */
import { auth } from '@lib/auth/better-auth/server';
import { getPgPool } from '@lib/server/pg/pool';
import { requireAdmin } from '@lib/services/admin/require-admin';

jest.mock('@lib/auth/better-auth/server', () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
}));

jest.mock('@lib/server/pg/pool', () => ({
  getPgPool: jest.fn(),
}));

type SessionShape = Awaited<ReturnType<typeof auth.api.getSession>>;

type QueryResultShape = {
  rows: Array<{ role: string | null }>;
};

describe('requireAdmin', () => {
  const mockedGetSession = auth.api.getSession as jest.MockedFunction<
    typeof auth.api.getSession
  >;
  const mockedGetPgPool = getPgPool as jest.MockedFunction<typeof getPgPool>;
  const queryMock = jest.fn<
    Promise<QueryResultShape>,
    [queryText: string, values?: unknown[]]
  >();

  const headers = new Headers();

  const buildSession = (userId: string): SessionShape =>
    ({
      session: {
        id: 'session-id',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId,
        expiresAt: new Date(Date.now() + 60_000),
        token: 'test-token',
        ipAddress: null,
        userAgent: 'jest',
      },
      user: {
        id: userId,
        email: `${userId}@example.com`,
        name: userId,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        image: null,
      },
    }) as SessionShape;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetPgPool.mockReturnValue({
      query: queryMock,
    } as unknown as ReturnType<typeof getPgPool>);
  });

  it('returns 401 when user is not authenticated', async () => {
    mockedGetSession.mockResolvedValueOnce(null as SessionShape);

    const result = await requireAdmin(headers);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected auth failure result');
    expect(result.response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 500 when role check query fails', async () => {
    mockedGetSession.mockResolvedValueOnce(buildSession('user-1'));
    queryMock.mockRejectedValueOnce(new Error('db error'));

    const result = await requireAdmin(headers);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected auth failure result');
    expect(result.response.status).toBe(500);
  });

  it('returns 403 when user role is not admin', async () => {
    mockedGetSession.mockResolvedValueOnce(buildSession('user-1'));
    queryMock.mockResolvedValueOnce({
      rows: [{ role: 'user' }],
    });

    const result = await requireAdmin(headers);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected auth failure result');
    expect(result.response.status).toBe(403);
  });

  it('returns ok=true with userId for admin', async () => {
    mockedGetSession.mockResolvedValueOnce(buildSession('admin-1'));
    queryMock.mockResolvedValueOnce({
      rows: [{ role: 'admin' }],
    });

    const result = await requireAdmin(headers);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected auth success result');
    expect(result.userId).toBe('admin-1');
  });
});
