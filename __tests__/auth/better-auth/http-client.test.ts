import {
  type BetterAuthSession,
  getCurrentSession,
} from '@lib/auth/better-auth/http-client';

describe('better-auth http-client getCurrentSession', () => {
  const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

  function jsonResponse(body: unknown, status: number = 200): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      json: jest.fn().mockResolvedValue(body),
    } as unknown as Response;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when auth endpoint returns 401', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({}, 401));

    const session = await getCurrentSession({ forceRefresh: true });

    expect(session).toBeNull();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0]?.[0]).toBe('/api/auth/better/get-session');
  });

  it('returns session unchanged when user id is already UUID', async () => {
    const payload: BetterAuthSession = {
      session: {
        id: 'session-id',
        userId: '00000000-0000-4000-8000-000000000100',
      },
      user: {
        id: '00000000-0000-4000-8000-000000000100',
        email: 'uuid.user@example.com',
      },
    };
    mockedFetch.mockResolvedValueOnce(jsonResponse(payload, 200));

    const session = await getCurrentSession({ forceRefresh: true });

    expect(session).toEqual(payload);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('maps legacy non-UUID user id to internal UUID from profile-status', async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse(
          {
            session: {
              id: 'session-id',
              userId: 'legacy-auth-id',
            },
            user: {
              id: 'legacy-auth-id',
              email: 'legacy.user@example.com',
            },
          },
          200
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            userId: '00000000-0000-4000-8000-000000000101',
            authUserId: 'legacy-auth-id',
            role: 'user',
            status: 'active',
          },
          200
        )
      );

    const session = await getCurrentSession({ forceRefresh: true });

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch.mock.calls[0]?.[0]).toBe('/api/auth/better/get-session');
    expect(mockedFetch.mock.calls[1]?.[0]).toBe(
      '/api/internal/auth/profile-status'
    );
    expect(session?.user?.id).toBe('00000000-0000-4000-8000-000000000101');
    expect(session?.user?.auth_user_id).toBe('legacy-auth-id');
    expect(session?.user?.role).toBe('user');
    expect(session?.user?.status).toBe('active');
    expect(session?.session?.userId).toBe(
      '00000000-0000-4000-8000-000000000101'
    );
    expect(session?.session?.authUserId).toBe('legacy-auth-id');
  });

  it('throws when legacy user id cannot be resolved to internal UUID', async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse(
          {
            session: {
              id: 'session-id',
              userId: 'legacy-auth-id',
            },
            user: {
              id: 'legacy-auth-id',
              email: 'legacy.user@example.com',
            },
          },
          200
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            role: 'user',
            status: 'active',
          },
          200
        )
      );

    await expect(getCurrentSession({ forceRefresh: true })).rejects.toThrow(
      'Failed to resolve internal UUID for current session user'
    );
  });
});
