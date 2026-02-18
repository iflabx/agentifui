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
      changePassword: jest.fn(),
    },
  },
}));

const changePasswordMock = auth.api.changePassword as unknown as jest.Mock;

describe('internal auth local-password change route', () => {
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
      data: true,
    });
    (markFallbackPasswordUpdated as jest.Mock).mockResolvedValue({
      success: true,
      data: undefined,
    });
    changePasswordMock.mockResolvedValue({ token: 'session-token' });
  });

  it('returns 400 for invalid payload', async () => {
    const response = await POST(
      new Request('http://localhost/api/internal/auth/local-password/change', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ newPassword: 'abc' }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('currentPassword and newPassword are required');
    expect(payload.app_error?.code).toBe(
      'LOCAL_PASSWORD_CHANGE_FIELDS_MISSING'
    );
    expect(typeof payload.request_id).toBe('string');
  });

  it('returns 409 when fallback password is missing', async () => {
    (hasCredentialPasswordByAuthUserId as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: false,
    });

    const response = await POST(
      new Request('http://localhost/api/internal/auth/local-password/change', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: 'OldPass123!',
          newPassword: 'NewPass123!',
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('Fallback password is not set');
    expect(payload.app_error?.code).toBe('LOCAL_PASSWORD_NOT_SET');
    expect(typeof payload.request_id).toBe('string');
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it('changes fallback password and writes metadata', async () => {
    const request = new Request(
      'http://localhost/api/internal/auth/local-password/change',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: 'OldPass123!',
          newPassword: 'NewPass123!',
          revokeOtherSessions: true,
        }),
      }
    );

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      token: 'session-token',
    });
    expect(changePasswordMock).toHaveBeenCalledTimes(1);
    expect(changePasswordMock.mock.calls[0][0]).toMatchObject({
      body: {
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass123!',
        revokeOtherSessions: true,
      },
    });
    expect(markFallbackPasswordUpdated).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      { actorUserId: '00000000-0000-4000-8000-000000000001' }
    );
  });

  it('maps better-auth errors to http response', async () => {
    changePasswordMock.mockRejectedValueOnce({
      status: 400,
      message: 'Invalid password',
    });

    const response = await POST(
      new Request('http://localhost/api/internal/auth/local-password/change', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: 'wrong',
          newPassword: 'NewPass123!',
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('Invalid password');
    expect(payload.app_error?.code).toBe('LOCAL_PASSWORD_CHANGE_FAILED');
    expect(typeof payload.request_id).toBe('string');
  });
});
