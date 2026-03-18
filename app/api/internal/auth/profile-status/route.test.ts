/** @jest-environment node */
import { resolveSessionIdentityReadOnly } from '@lib/auth/better-auth/session-identity';
import { syncSessionIdentitySideEffects } from '@lib/auth/better-auth/session-identity';
import { REQUEST_ID_HEADER } from '@lib/errors/app-error';

import { GET } from './route';

jest.mock('@lib/auth/better-auth/session-identity', () => ({
  isRecoverableReadOnlyIdentityError: jest.fn((error?: Error | null) =>
    Boolean(error?.message?.includes('Missing profile row for session user'))
  ),
  resolveSessionIdentityReadOnly: jest.fn(),
  syncSessionIdentitySideEffects: jest.fn(),
}));

describe('Internal Auth Profile Status Route', () => {
  const mockedResolveSessionIdentityReadOnly =
    resolveSessionIdentityReadOnly as jest.MockedFunction<
      typeof resolveSessionIdentityReadOnly
    >;
  const mockedSyncSessionIdentitySideEffects =
    syncSessionIdentitySideEffects as jest.MockedFunction<
      typeof syncSessionIdentitySideEffects
    >;

  function createRequest(): Request {
    return new Request(
      'http://localhost:3000/api/internal/auth/profile-status',
      {
        method: 'GET',
        headers: new Headers(),
      }
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when session is not authenticated', async () => {
    mockedResolveSessionIdentityReadOnly.mockResolvedValueOnce({
      success: true,
      data: null,
    });

    const response = await GET(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    expect(payload.success).toBe(false);
    expect(payload.app_error?.code).toBe('AUTH_UNAUTHORIZED');
  });

  it('returns 500 when session identity resolve fails', async () => {
    mockedResolveSessionIdentityReadOnly.mockResolvedValueOnce({
      success: false,
      error: new Error('resolve failed'),
    });

    const response = await GET(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    expect(payload.success).toBe(false);
    expect(payload.app_error?.code).toBe('AUTH_PROFILE_STATUS_RESOLVE_FAILED');
  });

  it('recovers missing profile rows via side-effect sync', async () => {
    mockedResolveSessionIdentityReadOnly.mockResolvedValueOnce({
      success: false,
      error: new Error('Missing profile row for session user'),
    });
    mockedSyncSessionIdentitySideEffects.mockResolvedValueOnce({
      success: true,
      data: {
        session: {
          session: {
            id: 'session-id',
            userId: '00000000-0000-4000-8000-000000000010',
          },
          user: {
            id: '00000000-0000-4000-8000-000000000010',
          },
        } as never,
        authUserId: '00000000-0000-4000-8000-000000000010',
        userId: '00000000-0000-4000-8000-000000000010',
        role: 'user',
        status: 'active',
      },
    });

    const response = await GET(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockedSyncSessionIdentitySideEffects).toHaveBeenCalledTimes(1);
    expect(payload).toEqual({
      userId: '00000000-0000-4000-8000-000000000010',
      authUserId: '00000000-0000-4000-8000-000000000010',
      role: 'user',
      status: 'active',
    });
  });

  it('returns profile status payload for authenticated identity', async () => {
    mockedResolveSessionIdentityReadOnly.mockResolvedValueOnce({
      success: true,
      data: {
        session: {
          session: {
            id: 'session-id',
            userId: '00000000-0000-4000-8000-000000000010',
          },
          user: {
            id: '00000000-0000-4000-8000-000000000010',
          },
        } as never,
        authUserId: '00000000-0000-4000-8000-000000000010',
        userId: '00000000-0000-4000-8000-000000000010',
        role: 'admin',
        status: 'active',
      },
    });

    const response = await GET(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(payload).toEqual({
      userId: '00000000-0000-4000-8000-000000000010',
      authUserId: '00000000-0000-4000-8000-000000000010',
      role: 'admin',
      status: 'active',
    });
  });
});
