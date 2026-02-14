/** @jest-environment node */
import {
  getAuthModeSetting,
  setAuthModeSetting,
} from '@lib/auth/better-auth/local-login-policy';
import { requireAdmin } from '@lib/services/admin/require-admin';

jest.mock('@lib/services/admin/require-admin', () => ({
  requireAdmin: jest.fn(),
}));

jest.mock('@lib/auth/better-auth/local-login-policy', () => ({
  getAuthModeSetting: jest.fn(),
  setAuthModeSetting: jest.fn(),
}));

describe('admin auth fallback policy route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue({
      ok: true,
      userId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('returns current auth mode', async () => {
    (getAuthModeSetting as jest.Mock).mockResolvedValue({
      success: true,
      data: 'normal',
    });

    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/admin/auth/fallback-policy')
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.authMode).toBe('normal');
  });

  it('rejects invalid patch payload', async () => {
    const { PATCH } = await import('./route');
    const response = await PATCH(
      new Request('http://localhost/api/admin/auth/fallback-policy', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ authMode: 'invalid' }),
      })
    );

    expect(response.status).toBe(400);
    expect(setAuthModeSetting).not.toHaveBeenCalled();
  });

  it('updates auth mode', async () => {
    (setAuthModeSetting as jest.Mock).mockResolvedValue({
      success: true,
      data: 'degraded',
    });

    const { PATCH } = await import('./route');
    const response = await PATCH(
      new Request('http://localhost/api/admin/auth/fallback-policy', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ authMode: 'degraded' }),
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.authMode).toBe('degraded');
    expect(setAuthModeSetting).toHaveBeenCalledWith('degraded');
  });
});
