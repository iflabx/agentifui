/** @jest-environment node */
import { auth, getAuthProviderIssuer } from '@lib/auth/better-auth/server';
import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import {
  getProfileExternalAttributes,
  getUserIdentityByIssuerSubject,
  upsertProfileExternalAttributes,
  upsertUserIdentity,
} from '@lib/db/user-identities';
import { getPgPool } from '@lib/server/pg/pool';

jest.mock('@lib/auth/better-auth/server', () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
  getAuthProviderIssuer: jest.fn(),
}));

jest.mock('@lib/db/user-identities', () => ({
  getProfileExternalAttributes: jest.fn(),
  getUserIdentityByIssuerSubject: jest.fn(),
  upsertUserIdentity: jest.fn(),
  upsertProfileExternalAttributes: jest.fn(),
}));

jest.mock('@lib/server/pg/pool', () => ({
  getPgPool: jest.fn(),
}));

type PoolQueryResult = {
  rows: Array<{
    role: string | null;
    status: string | null;
  }>;
};

describe('resolveSessionIdentity', () => {
  const mockedGetSession = auth.api.getSession as jest.MockedFunction<
    typeof auth.api.getSession
  >;
  const mockedGetAuthProviderIssuer =
    getAuthProviderIssuer as jest.MockedFunction<typeof getAuthProviderIssuer>;
  const mockedGetProfileExternalAttributes =
    getProfileExternalAttributes as jest.MockedFunction<
      typeof getProfileExternalAttributes
    >;
  const mockedGetUserIdentityByIssuerSubject =
    getUserIdentityByIssuerSubject as jest.MockedFunction<
      typeof getUserIdentityByIssuerSubject
    >;
  const mockedUpsertUserIdentity = upsertUserIdentity as jest.MockedFunction<
    typeof upsertUserIdentity
  >;
  const mockedUpsertProfileExternalAttributes =
    upsertProfileExternalAttributes as jest.MockedFunction<
      typeof upsertProfileExternalAttributes
    >;
  const mockedGetPgPool = getPgPool as jest.MockedFunction<typeof getPgPool>;
  const queryMock = jest.fn<
    Promise<PoolQueryResult>,
    [queryText: string, params?: unknown[]]
  >();
  const lockQueryMock = jest.fn();
  const lockReleaseMock = jest.fn();
  const poolConnectMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    lockQueryMock.mockResolvedValue({ rows: [] });
    poolConnectMock.mockResolvedValue({
      query: lockQueryMock,
      release: lockReleaseMock,
    });
    mockedGetPgPool.mockReturnValue({
      query: queryMock,
      connect: poolConnectMock,
    } as unknown as ReturnType<typeof getPgPool>);
    mockedGetAuthProviderIssuer.mockReturnValue(null);
    mockedGetProfileExternalAttributes.mockResolvedValue({
      success: true,
      data: null,
    });
    mockedGetUserIdentityByIssuerSubject.mockResolvedValue({
      success: true,
      data: null,
    });
    mockedUpsertUserIdentity.mockImplementation(async input => ({
      success: true,
      data: {
        user_id: input.user_id,
      } as never,
    }));
    mockedUpsertProfileExternalAttributes.mockResolvedValue({
      success: true,
      data: {} as never,
    });
  });

  it('returns null when no authenticated session exists', async () => {
    mockedGetSession.mockResolvedValueOnce(null);

    const result = await resolveSessionIdentity(new Headers());

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected success result');
    expect(result.data).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns existing UUID user without creating identity mapping', async () => {
    mockedGetSession.mockResolvedValueOnce({
      session: {
        id: 'session-id',
      },
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'uuid.user@example.com',
        name: 'UUID User',
      },
    } as never);

    queryMock.mockResolvedValueOnce({
      rows: [{ role: 'user', status: 'active' }],
    });

    const result = await resolveSessionIdentity(new Headers());

    expect(result.success).toBe(true);
    if (!result.success || !result.data) {
      throw new Error('Expected resolved identity data');
    }
    expect(result.data.userId).toBe('00000000-0000-4000-8000-000000000001');
    expect(result.data.role).toBe('user');
    expect(result.data.status).toBe('active');
    expect(mockedUpsertUserIdentity).toHaveBeenCalledTimes(1);
    expect(mockedUpsertUserIdentity.mock.calls[0]?.[0].issuer).toBe(
      'urn:agentifui:better-auth'
    );
    expect(mockedUpsertUserIdentity.mock.calls[0]?.[0].subject).toBe(
      '00000000-0000-4000-8000-000000000001'
    );
    expect(mockedUpsertProfileExternalAttributes).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('skips external attributes upsert when existing data is fresh', async () => {
    mockedGetSession.mockResolvedValueOnce({
      session: {
        id: 'session-id',
      },
      user: {
        id: '00000000-0000-4000-8000-000000000011',
        email: 'uuid.user@example.com',
        name: 'UUID User',
        employee_number: 'EMP-1002',
        app_metadata: {
          provider: 'github',
        },
      },
    } as never);
    mockedGetAuthProviderIssuer.mockReturnValue('https://idp.example.com');
    mockedGetProfileExternalAttributes.mockResolvedValueOnce({
      success: true,
      data: {
        user_id: '00000000-0000-4000-8000-000000000011',
        source_issuer: 'https://idp.example.com',
        source_provider: 'github',
        synced_at: new Date().toISOString(),
      } as never,
    });
    queryMock.mockResolvedValueOnce({
      rows: [{ role: 'user', status: 'active' }],
    });

    const result = await resolveSessionIdentity(new Headers());

    expect(result.success).toBe(true);
    if (!result.success || !result.data) {
      throw new Error('Expected resolved identity data');
    }

    expect(mockedUpsertProfileExternalAttributes).not.toHaveBeenCalled();
  });

  it('uses existing legacy mapping when auth user id is non-UUID', async () => {
    mockedGetSession.mockResolvedValueOnce({
      session: {
        id: 'session-id',
      },
      user: {
        id: 'legacy-user-id',
        email: 'legacy.user@example.com',
        name: 'Legacy User',
      },
    } as never);

    mockedGetUserIdentityByIssuerSubject.mockResolvedValueOnce({
      success: true,
      data: {
        user_id: '00000000-0000-4000-8000-000000000002',
      } as never,
    });
    queryMock.mockResolvedValueOnce({
      rows: [{ role: 'admin', status: 'active' }],
    });

    const result = await resolveSessionIdentity(new Headers());

    expect(result.success).toBe(true);
    if (!result.success || !result.data) {
      throw new Error('Expected resolved identity data');
    }
    expect(result.data.userId).toBe('00000000-0000-4000-8000-000000000002');
    expect(mockedUpsertUserIdentity).not.toHaveBeenCalled();
    expect(mockedUpsertProfileExternalAttributes).not.toHaveBeenCalled();
  });

  it('creates legacy mapping and syncs external attributes', async () => {
    mockedGetSession.mockResolvedValueOnce({
      session: {
        id: 'session-id',
      },
      user: {
        id: 'legacy-user-id',
        email: 'new.user@example.com',
        name: 'New User',
        employee_number: 'EMP-1001',
        app_metadata: {
          provider: 'github',
        },
      },
    } as never);
    mockedGetAuthProviderIssuer.mockReturnValue('https://idp.example.com');
    mockedGetUserIdentityByIssuerSubject
      .mockResolvedValueOnce({
        success: true,
        data: null,
      })
      .mockResolvedValueOnce({
        success: true,
        data: null,
      });
    queryMock
      .mockResolvedValueOnce({
        rows: [],
      })
      .mockResolvedValueOnce({
        rows: [{ role: 'user', status: 'active' }],
      });

    const result = await resolveSessionIdentity(new Headers());

    expect(result.success).toBe(true);
    if (!result.success || !result.data) {
      throw new Error('Expected resolved identity data');
    }

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(mockedUpsertUserIdentity).toHaveBeenCalledTimes(1);

    const firstUpsert = mockedUpsertUserIdentity.mock.calls[0][0];

    expect(firstUpsert.issuer).toBe('urn:agentifui:better-auth');
    expect(firstUpsert.provider).toBe('better-auth');
    expect(firstUpsert.subject).toBe('legacy-user-id');
    expect(firstUpsert.user_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    expect(mockedUpsertProfileExternalAttributes).toHaveBeenCalledTimes(1);
    expect(
      mockedUpsertProfileExternalAttributes.mock.calls[0][0].source_issuer
    ).toBe('https://idp.example.com');
    expect(
      mockedUpsertProfileExternalAttributes.mock.calls[0][0].source_provider
    ).toBe('github');
    expect(
      mockedUpsertProfileExternalAttributes.mock.calls[0][0].employee_number
    ).toBe('EMP-1001');
  });

  it('uses mapped owner returned by upsert during concurrent legacy mapping race', async () => {
    mockedGetSession.mockResolvedValueOnce({
      session: {
        id: 'session-id',
      },
      user: {
        id: 'legacy-user-id',
        email: 'legacy.user@example.com',
        name: 'Legacy User',
      },
    } as never);

    const conflictOwner = '00000000-0000-4000-8000-000000000003';
    mockedGetUserIdentityByIssuerSubject
      .mockResolvedValueOnce({
        success: true,
        data: null,
      })
      .mockResolvedValueOnce({
        success: true,
        data: null,
      });
    mockedUpsertUserIdentity.mockResolvedValueOnce({
      success: true,
      data: {
        user_id: conflictOwner,
      } as never,
    });
    queryMock
      .mockResolvedValueOnce({
        rows: [],
      })
      .mockResolvedValueOnce({
        rows: [{ role: 'user', status: 'active' }],
      })
      .mockResolvedValueOnce({
        rows: [],
      })
      .mockResolvedValueOnce({
        rows: [{ role: 'user', status: 'active' }],
      });

    const result = await resolveSessionIdentity(new Headers());

    expect(result.success).toBe(true);
    if (!result.success || !result.data) {
      throw new Error('Expected resolved identity data');
    }

    expect(result.data.userId).toBe(conflictOwner);
    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(mockedUpsertProfileExternalAttributes).not.toHaveBeenCalled();
  });
});
