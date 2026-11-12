/** @jest-environment node */
import { ensureProfileStatus } from '@lib/auth/better-auth/session-identity/persistence/profile-status';
import { publishProfileChangeBestEffort } from '@lib/auth/better-auth/session-identity/persistence/publisher';
import { runWithPgUserContext } from '@lib/server/pg/user-context';

jest.mock('@lib/auth/better-auth/server', () => ({
  getAuthProviderIssuer: jest.fn(),
}));
jest.mock('@lib/server/pg/user-context', () => ({
  runWithPgUserContext: jest.fn(),
  runWithPgSystemContext: jest.fn(),
}));
jest.mock(
  '@lib/auth/better-auth/session-identity/persistence/publisher',
  () => ({
    publishProfileChangeBestEffort: jest.fn(),
  })
);

describe('profile authentication lifecycle', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const sessionUser = {
    id: userId,
    email: 'user@example.invalid',
    name: 'User',
  };
  const query = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    jest
      .mocked(runWithPgUserContext)
      .mockImplementation((_userId, operation) =>
        operation({ query } as never)
      );
  });

  it('does not recreate a deleted account from a cached session', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await ensureProfileStatus(userId, sessionUser);
    expect(result.success).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'FROM auth_users WHERE id::text = $1 FOR KEY SHARE'
      ),
      [userId]
    );
    expect(publishProfileChangeBestEffort).not.toHaveBeenCalled();
  });

  it('creates a new profile only while holding the authentication row lock', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: userId }] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({
      rows: [{ id: userId, role: 'user', status: 'active' }],
    });
    const result = await ensureProfileStatus(userId, sessionUser);
    expect(result).toMatchObject({
      success: true,
      data: { created: true, status: 'active' },
    });
    expect(runWithPgUserContext).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[2][0]).toContain('INSERT INTO profiles');
    expect(publishProfileChangeBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'INSERT' })
    );
  });

  it('does not reactivate a suspended profile', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: userId }] });
    query.mockResolvedValueOnce({
      rows: [{ id: userId, role: 'user', status: 'suspended' }],
    });
    expect(await ensureProfileStatus(userId, sessionUser)).toMatchObject({
      success: true,
      data: { created: false, status: 'suspended' },
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
