/** @jest-environment node */
import { ensureProfileStatus } from '@lib/auth/better-auth/session-identity/persistence/profile-status';
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
  () => ({ publishProfileChangeBestEffort: jest.fn() })
);

describe('profile name synchronization', () => {
  const query = jest.fn();
  const userId = '00000000-0000-4000-8000-000000000001';
  const row = {
    id: userId,
    full_name: 'Edited Name',
    role: 'user',
    status: 'active',
  };
  const sessionUser = {
    id: userId,
    name: 'Registration Name',
    email: 'user@example.com',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    jest
      .mocked(runWithPgUserContext)
      .mockImplementation(async (_userId, operation) =>
        operation({ query } as never)
      );
  });

  it('preserves the existing local profile name while still filling missing names', async () => {
    query.mockResolvedValueOnce({ rows: [row] });
    expect((await ensureProfileStatus(userId, sessionUser)).success).toBe(true);
    expect(query.mock.calls[0][0]).toContain(
      "WHEN $5 = 'better-auth' THEN COALESCE(full_name, $2)"
    );
    expect(query.mock.calls[0][1]).toEqual([
      userId,
      'Registration Name',
      null,
      'user@example.com',
      'better-auth',
    ]);
  });

  it('retains authoritative external-provider name synchronization', async () => {
    query.mockResolvedValueOnce({ rows: [row] });
    await ensureProfileStatus(userId, { ...sessionUser, provider: 'oidc' });
    expect(query.mock.calls[0][0]).toContain('ELSE COALESCE($2, full_name)');
    expect(query.mock.calls[0][1][4]).toBe('oidc');
  });

  it('initializes new profiles with the session name', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] });
    const result = await ensureProfileStatus(userId, sessionUser);
    expect(result.success && result.data.created).toBe(true);
    expect(query.mock.calls[1][0]).toContain('INSERT INTO profiles');
    expect(query.mock.calls[1][1][1]).toBe('Registration Name');
  });

  it('also preserves local edits when the initial insert loses a race', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] });
    const result = await ensureProfileStatus(userId, sessionUser);
    expect(result.success && result.data.created).toBe(false);
    expect(query.mock.calls[2][0]).toContain(
      "WHEN $5 = 'better-auth' THEN COALESCE(full_name, $2)"
    );
  });
});
