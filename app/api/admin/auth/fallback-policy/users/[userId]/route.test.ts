/** @jest-environment node */
import {
  getUserLocalLoginStateByUserId,
  setUserLocalLoginEnabledByUserId,
} from '@lib/auth/better-auth/local-login-policy';
import { requireAdmin } from '@lib/services/admin/require-admin';

jest.mock('@lib/services/admin/require-admin', () => ({
  requireAdmin: jest.fn(),
}));

jest.mock('@lib/auth/better-auth/local-login-policy', () => ({
  getUserLocalLoginStateByUserId: jest.fn(),
  setUserLocalLoginEnabledByUserId: jest.fn(),
}));

describe('admin auth fallback policy user route', () => {
  const params = Promise.resolve({
    userId: '00000000-0000-4000-8000-000000000001',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue({
      ok: true,
      userId: '00000000-0000-4000-8000-000000000009',
    });
  });

  it('returns user fallback state', async () => {
    (getUserLocalLoginStateByUserId as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        userId: '00000000-0000-4000-8000-000000000001',
        email: 'user@example.com',
        authSource: 'oidc',
        localLoginEnabled: true,
        localLoginUpdatedAt: '2026-02-14T00:00:00.000Z',
      },
    });

    const { GET } = await import('./route');
    const response = await GET(
      new Request(
        'http://localhost/api/admin/auth/fallback-policy/users/00000000-0000-4000-8000-000000000001'
      ),
      { params }
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.localLoginEnabled).toBe(true);
  });

  it('rejects invalid patch payload', async () => {
    const { PATCH } = await import('./route');
    const response = await PATCH(
      new Request(
        'http://localhost/api/admin/auth/fallback-policy/users/00000000-0000-4000-8000-000000000001',
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ localLoginEnabled: 'yes' }),
        }
      ),
      { params }
    );

    expect(response.status).toBe(400);
    expect(setUserLocalLoginEnabledByUserId).not.toHaveBeenCalled();
  });

  it('updates user fallback state', async () => {
    (setUserLocalLoginEnabledByUserId as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        userId: '00000000-0000-4000-8000-000000000001',
        email: 'user@example.com',
        authSource: 'oidc',
        localLoginEnabled: false,
        localLoginUpdatedAt: '2026-02-14T00:00:00.000Z',
      },
    });

    const { PATCH } = await import('./route');
    const response = await PATCH(
      new Request(
        'http://localhost/api/admin/auth/fallback-policy/users/00000000-0000-4000-8000-000000000001',
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ localLoginEnabled: false }),
        }
      ),
      { params }
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.localLoginEnabled).toBe(false);
    expect(setUserLocalLoginEnabledByUserId).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      false
    );
  });
});
