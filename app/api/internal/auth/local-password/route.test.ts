/** @jest-environment node */
import {
  getAuthModeSetting,
  getUserLocalLoginStateByUserId,
  hasCredentialPasswordByAuthUserId,
} from '@lib/auth/better-auth/local-login-policy';
import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';

import { GET } from './route';

jest.mock('@lib/auth/better-auth/session-identity', () => ({
  resolveSessionIdentity: jest.fn(),
}));

jest.mock('@lib/auth/better-auth/local-login-policy', () => ({
  getAuthModeSetting: jest.fn(),
  getUserLocalLoginStateByUserId: jest.fn(),
  hasCredentialPasswordByAuthUserId: jest.fn(),
}));

describe('internal auth local-password route', () => {
  const mockedResolveSessionIdentity =
    resolveSessionIdentity as jest.MockedFunction<
      typeof resolveSessionIdentity
    >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when user is unauthenticated', async () => {
    mockedResolveSessionIdentity.mockResolvedValueOnce({
      success: true,
      data: null,
    });

    const response = await GET(
      new Request('http://localhost/api/internal/auth/local-password')
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
  });

  it('returns merged local-password state for authenticated user', async () => {
    mockedResolveSessionIdentity.mockResolvedValueOnce({
      success: true,
      data: {
        session: {} as never,
        authUserId: '00000000-0000-4000-8000-000000000002',
        userId: '00000000-0000-4000-8000-000000000001',
        role: 'user',
        status: 'active',
      },
    });

    (getAuthModeSetting as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: 'degraded',
    });
    (getUserLocalLoginStateByUserId as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: {
        userId: '00000000-0000-4000-8000-000000000001',
        email: 'user@example.com',
        authSource: 'oidc',
        localLoginEnabled: true,
        localLoginUpdatedAt: '2026-02-14T00:00:00.000Z',
        fallbackPasswordSetAt: '2026-02-14T01:00:00.000Z',
        fallbackPasswordUpdatedBy: '00000000-0000-4000-8000-000000000009',
      },
    });
    (hasCredentialPasswordByAuthUserId as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: true,
    });

    const response = await GET(
      new Request('http://localhost/api/internal/auth/local-password')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toMatchObject({
      userId: '00000000-0000-4000-8000-000000000001',
      authUserId: '00000000-0000-4000-8000-000000000002',
      authMode: 'degraded',
      localLoginEnabled: true,
      hasFallbackPassword: true,
      localLoginAllowedNow: true,
    });
  });

  it('returns 500 when local state query fails', async () => {
    mockedResolveSessionIdentity.mockResolvedValueOnce({
      success: true,
      data: {
        session: {} as never,
        authUserId: '00000000-0000-4000-8000-000000000002',
        userId: '00000000-0000-4000-8000-000000000001',
        role: 'user',
        status: 'active',
      },
    });

    (getAuthModeSetting as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: 'normal',
    });
    (getUserLocalLoginStateByUserId as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: new Error('db error'),
    });
    (hasCredentialPasswordByAuthUserId as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: false,
    });

    const response = await GET(
      new Request('http://localhost/api/internal/auth/local-password')
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Failed to read local password state' });
  });
});
