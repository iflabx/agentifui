/** @jest-environment node */
import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';

import { GET } from './route';

jest.mock('@lib/auth/better-auth/session-identity', () => ({
  resolveSessionIdentity: jest.fn(),
}));

describe('Internal Auth Profile Status Route', () => {
  const mockedResolveSessionIdentity =
    resolveSessionIdentity as jest.MockedFunction<
      typeof resolveSessionIdentity
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
    mockedResolveSessionIdentity.mockResolvedValueOnce({
      success: true,
      data: null,
    });

    const response = await GET(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'unauthorized' });
  });

  it('returns 500 when session identity resolve fails', async () => {
    mockedResolveSessionIdentity.mockResolvedValueOnce({
      success: false,
      error: new Error('resolve failed'),
    });

    const response = await GET(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'profile_status_failed' });
  });

  it('returns profile status payload for authenticated identity', async () => {
    mockedResolveSessionIdentity.mockResolvedValueOnce({
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
      role: 'admin',
      status: 'active',
    });
  });
});
