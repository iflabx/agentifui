/** @jest-environment node */
import { runWithPgSystemContext } from '../../lib/pg-context';
import { handleUserAction } from './user-actions';

jest.mock('../../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
  queryRowsWithPgUserContext: jest.fn(),
  runWithPgSystemContext: jest.fn(),
}));
jest.mock('./domain-helpers', () => ({ loadGroupsByUserIdMap: jest.fn() }));

describe('user deletion', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const query = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    jest
      .mocked(runWithPgSystemContext)
      .mockImplementation(operation => operation({ query } as never));
  });

  it('locks the authentication account and deletes both records in one transaction', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: userId }] });
    query.mockResolvedValueOnce({ rows: [{ id: userId }] });
    query.mockResolvedValueOnce({ rows: [] });
    const response = await handleUserAction(
      'users.deleteUser',
      { userId },
      'admin'
    );
    expect(response?.statusCode).toBe(200);
    expect(runWithPgSystemContext).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining('FROM auth_users WHERE id = $1::uuid FOR UPDATE'),
      expect.stringContaining('DELETE FROM profiles'),
      expect.stringContaining('DELETE FROM auth_users'),
    ]);
    for (const [, parameters] of query.mock.calls) {
      expect(parameters).toEqual([userId]);
    }
  });

  it('does not remove authentication records for a missing profile', async () => {
    query.mockResolvedValue({ rows: [] });
    const response = await handleUserAction(
      'users.deleteUser',
      { userId },
      'admin'
    );
    expect(response?.statusCode).toBe(404);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not delete the current administrator', async () => {
    const response = await handleUserAction(
      'users.deleteUser',
      { userId },
      userId
    );
    expect(response?.statusCode).toBe(403);
    expect(runWithPgSystemContext).not.toHaveBeenCalled();
  });

  it('leaves transaction failure handling to the database context', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: userId }] });
    query.mockResolvedValueOnce({ rows: [{ id: userId }] });
    query.mockRejectedValueOnce(new Error('authentication deletion failed'));
    await expect(
      handleUserAction('users.deleteUser', { userId }, 'admin')
    ).rejects.toThrow('authentication deletion failed');
  });
});
