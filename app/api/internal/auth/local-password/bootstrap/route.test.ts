/** @jest-environment node */
import {
  hasCredentialPasswordByAuthUserId,
  markFallbackPasswordUpdated,
} from '@lib/auth/better-auth/local-login-policy';
import { auth } from '@lib/auth/better-auth/server';
import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';

import { POST } from './route';

jest.mock('@lib/auth/better-auth/session-identity', () => ({
  resolveSessionIdentity: jest.fn(),
}));

jest.mock('@lib/auth/better-auth/local-login-policy', () => ({
  hasCredentialPasswordByAuthUserId: jest.fn(),
  markFallbackPasswordUpdated: jest.fn(),
}));

jest.mock('@lib/auth/better-auth/server', () => ({
  auth: {
    api: {
      setPassword: jest.fn(),
    },
  },
}));

const setPasswordMock = auth.api.setPassword as unknown as jest.Mock;

describe('internal auth local-password bootstrap route', () => {
  const mockedResolveSessionIdentity =
    resolveSessionIdentity as jest.MockedFunction<
      typeof resolveSessionIdentity
    >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedResolveSessionIdentity.mockResolvedValue({
      success: true,
      data: {
        session: {} as never,
        authUserId: '00000000-0000-4000-8000-000000000002',
        userId: '00000000-0000-4000-8000-000000000001',
        role: 'user',
        status: 'active',
      },
    });
    (hasCredentialPasswordByAuthUserId as jest.Mock).mockResolvedValue({
      success: true,
      data: false,
    });
    (markFallbackPasswordUpdated as jest.Mock).mockResolvedValue({
      success: true,
      data: undefined,
    });
    setPasswordMock.mockResolvedValue({ status: true });
  });

  it('returns 400 for invalid payload', async () => {
    const response = await POST(
      new Request(
        'http://localhost/api/internal/auth/local-password/bootstrap',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'newPassword is required' });
  });

  it('returns 409 when fallback password already exists', async () => {
    (hasCredentialPasswordByAuthUserId as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: true,
    });

    const response = await POST(
      new Request(
        'http://localhost/api/internal/auth/local-password/bootstrap',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ newPassword: 'NewPass123!' }),
        }
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: 'Fallback password already set' });
    expect(setPasswordMock).not.toHaveBeenCalled();
  });

  it('sets fallback password and writes metadata', async () => {
    const request = new Request(
      'http://localhost/api/internal/auth/local-password/bootstrap',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ newPassword: 'NewPass123!' }),
      }
    );

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(setPasswordMock).toHaveBeenCalledTimes(1);
    expect(setPasswordMock.mock.calls[0][0]).toMatchObject({
      body: { newPassword: 'NewPass123!' },
    });
    expect(markFallbackPasswordUpdated).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001'
    );
  });

  it('maps better-auth errors to http response', async () => {
    setPasswordMock.mockRejectedValueOnce({
      status: 400,
      message: 'Password is too short',
    });

    const response = await POST(
      new Request(
        'http://localhost/api/internal/auth/local-password/bootstrap',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ newPassword: 'x' }),
        }
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Password is too short' });
  });
});
