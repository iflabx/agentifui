/** @jest-environment node */
import type { PoolClient } from 'pg';

import { handleGroupAdminAction } from './group-admin-actions';
import { handleUserAction } from './user-actions';

jest.mock('../../lib/pg-context', () => ({
  systemQueryForClient:
    (client: PoolClient) => async (sql: string, values: unknown[]) =>
      (await client.query(sql, values)).rows,
}));
jest.mock('./domain-helpers', () => ({
  loadGroupsByUserIdMap: jest.fn().mockResolvedValue(new Map()),
}));

const actorId = '00000000-0000-4000-8000-000000000001';
const targetId = '00000000-0000-4000-8000-000000000002';
const query = jest.fn();
const client = { query } as unknown as PoolClient;

beforeEach(() => jest.resetAllMocks());

describe('administrator target protection', () => {
  it.each([
    [actorId, 'admin', { role: 'user' }],
    [actorId, 'admin', { status: 'suspended' }],
    [targetId, 'admin', { role: 'user' }],
  ])(
    'rejects protected profile changes to %s',
    async (userId, role, updates) => {
      query.mockResolvedValueOnce({
        rows: [
          { id: userId, role, status: 'active', auth_source: 'better-auth' },
        ],
      });
      const result = await handleUserAction(
        'users.updateUserProfile',
        { userId, updates },
        actorId,
        client
      );
      expect(result?.statusCode).toBe(403);
      expect(query).toHaveBeenCalledTimes(1);
    }
  );

  it('allows unchanged self role and ordinary profile edits', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: actorId,
          role: 'admin',
          status: 'active',
          auth_source: 'better-auth',
        },
      ],
    });
    query.mockResolvedValueOnce({
      rows: [
        { id: actorId, role: 'admin', status: 'active', full_name: 'Edited' },
      ],
    });
    const result = await handleUserAction(
      'users.updateUserProfile',
      { userId: actorId, updates: { role: 'admin', full_name: 'Edited' } },
      actorId,
      client
    );
    expect(result?.statusCode).toBe(200);
    expect(query.mock.calls[1][0]).toContain('UPDATE profiles');
  });

  it('rejects a batch with a protected target before updating any rows', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: actorId, role: 'admin' },
        { id: targetId, role: 'user' },
      ],
    });
    const result = await handleUserAction(
      'users.batchUpdateUserRole',
      { userIds: [actorId, targetId], role: 'user' },
      actorId,
      client
    );
    expect(result?.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('allows a batch containing an unchanged administrator role', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: actorId, role: 'admin' },
        { id: targetId, role: 'user' },
      ],
    });
    query.mockResolvedValueOnce({ rows: [] });
    const result = await handleUserAction(
      'users.batchUpdateUserRole',
      { userIds: [actorId, targetId], role: 'admin' },
      actorId,
      client
    );
    expect(result?.statusCode).toBe(200);
    expect(query.mock.calls[1][0]).toContain('UPDATE profiles');
  });

  it('rejects batch self suspension without writing', async () => {
    const result = await handleUserAction(
      'users.batchUpdateUserStatus',
      { userIds: [actorId, targetId], status: 'suspended' },
      actorId,
      client
    );
    expect(result?.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('prevents deletion of another administrator', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: targetId }] });
    query.mockResolvedValueOnce({ rows: [{ role: 'admin' }] });
    const result = await handleUserAction(
      'users.deleteUser',
      { userId: targetId },
      actorId,
      client
    );
    expect(result?.statusCode).toBe(403);
    expect(query.mock.calls.every(([sql]) => !sql.includes('DELETE'))).toBe(
      true
    );
  });

  it.each(['better-auth', 'oidc'])(
    'does not pretend to rebind a %s authentication email',
    async auth_source => {
      query.mockResolvedValueOnce({
        rows: [{ id: targetId, role: 'user', status: 'active', auth_source }],
      });
      const result = await handleUserAction(
        'users.updateUserProfile',
        { userId: targetId, updates: { email: 'new@example.invalid' } },
        actorId,
        client
      );
      expect(result?.statusCode).toBe(400);
      expect(query).toHaveBeenCalledTimes(1);
    }
  );
});

describe('group grant quota updates', () => {
  it.each([
    [{ is_enabled: true }, null, false],
    [{ is_enabled: true, usage_quota: null }, null, true],
    [{ is_enabled: true, usage_quota: 0 }, 0, true],
    [{ is_enabled: true, usage_quota: 10 }, 10, true],
  ])(
    'distinguishes missing and explicit quotas: %j',
    async (data, quota, provided) => {
      query.mockResolvedValueOnce({ rows: [] });
      await handleGroupAdminAction(
        'groups.setGroupAppPermission',
        { groupId: actorId, serviceInstanceId: targetId, data },
        client
      );
      expect(query.mock.calls[0][1]).toEqual([
        actorId,
        targetId,
        quota,
        provided,
      ]);
      expect(query.mock.calls[0][0]).toContain(
        'ELSE group_app_permissions.usage_quota END'
      );
    }
  );

  it('soft disables without changing quota or usage', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await handleGroupAdminAction(
      'groups.setGroupAppPermission',
      {
        groupId: actorId,
        serviceInstanceId: targetId,
        data: { is_enabled: false },
      },
      client
    );
    expect(query.mock.calls[0][0]).toContain('SET is_enabled = FALSE');
    expect(query.mock.calls[0][0]).not.toMatch(
      /SET.*(?:usage_quota|used_count)\s*=/
    );
  });

  it('does not turn an invalid quota into unlimited access', async () => {
    const result = await handleGroupAdminAction(
      'groups.setGroupAppPermission',
      {
        groupId: actorId,
        serviceInstanceId: targetId,
        data: { is_enabled: true, usage_quota: '10' },
      },
      client
    );
    expect(result?.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});
