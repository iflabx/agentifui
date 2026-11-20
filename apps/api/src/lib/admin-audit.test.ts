import { toSuccessResponse } from '../routes/internal-data-route/helpers';
import { runAuditedAdminMutation } from './admin-audit';
import { getPgPool, queryRowsWithPgSystemContext } from './pg-context';

jest.mock('./pg-context', () => ({
  getPgPool: jest.fn(),
  queryRowsWithPgSystemContext: jest.fn(),
  runWithPgSystemContext: jest.fn(),
}));
const id = '10000000-0000-4000-8000-000000000001';
const groupId = '10000000-0000-4000-8000-000000000003';
const appId = '10000000-0000-4000-8000-000000000004';
const input = {
  action: 'users.updateUserProfile',
  payload: { userId: id },
  actorUserId: id,
  tokens: ['synthetic-token'],
  requestId: 'safe-request',
};

test.each([
  ['apiKeys.delete', 'apiKeys', id],
  ['apiKeys.update', 'apiKeys', id],
  ['apiKeys.create', 'apiKeys', id],
  ['groups.addGroupMember', 'groups', groupId],
  ['groups.removeGroupMember', 'groups', groupId],
  ['groups.setGroupAppPermission', 'groups', groupId],
  ['groups.removeAllGroupAppPermissions', 'serviceInstances', appId],
  ['users.updateUserProfile', 'users', '10000000-0000-4000-8000-000000000002'],
  ['users.batchUpdateUserRole', 'users', null],
  ['serviceInstances.update', 'serviceInstances', id],
  ['providers.deleteProvider', 'providers', id],
])(
  'audits the canonical target for %s',
  async (action, targetType, targetId) => {
    const unrelatedUser = '10000000-0000-4000-8000-000000000002';
    const query = jest.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('INSERT INTO admin_audit_events'))
        expect(values).toBeDefined();
      return { rows: sql.includes('FROM auth_sessions') ? [{ id }] : [] };
    });
    jest.mocked(getPgPool).mockReturnValue({
      connect: async () => ({ query, release: jest.fn() }),
    } as never);
    const response = await runAuditedAdminMutation(
      {
        ...input,
        action: action!,
        payload: {
          id: action === 'apiKeys.create' ? unrelatedUser : id,
          groupId,
          userId: unrelatedUser,
          userIds: [id],
          serviceInstanceId: appId,
        },
      },
      async () => toSuccessResponse({ id })
    );
    expect(response.statusCode).toBe(200);
    const audit = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO admin_audit_events')
    );
    expect(audit?.[1]?.slice(4, 6)).toEqual([targetType, targetId]);
  }
);

test.each([true, false])(
  'COMMIT uncertainty checks audit without reexecuting business (found=%s)',
  async found => {
    const query = jest.fn(async (sql: string) => {
      if (sql === 'COMMIT') throw new Error('synthetic lost connection');
      if (sql.includes('FROM auth_sessions')) return { rows: [{ id }] };
      return { rows: [] };
    });
    const release = jest.fn();
    jest
      .mocked(getPgPool)
      .mockReturnValue({ connect: async () => ({ query, release }) } as never);
    jest
      .mocked(queryRowsWithPgSystemContext)
      .mockResolvedValue(found ? [{ operation_id: id }] : []);
    const business = jest
      .fn()
      .mockResolvedValue(toSuccessResponse({ updated: true }));
    const response = await runAuditedAdminMutation(input, business);
    expect(business).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(true);
    expect(query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(
      1
    );
    expect(response.statusCode).toBe(found ? 200 : 503);
    expect(response.payload).toMatchObject(
      found
        ? {
            requiresRefresh: true,
            data: { updated: true },
            operationId: expect.any(String),
          }
        : { error: 'ADMIN_COMMIT_UNKNOWN', operationId: expect.any(String) }
    );
  }
);

test.each([
  {
    action: 'apiKeys.delete',
    before: [{ id, credential_version: 1, is_default: true }],
    after: [],
    expected: true,
  },
  {
    action: 'apiKeys.update',
    before: [{ id, credential_version: 1, is_default: false }],
    after: [{ id, credential_version: 1, is_default: true }],
    expected: true,
  },
  {
    action: 'apiKeys.update',
    before: [{ id, credential_version: 1, is_default: true }],
    after: [{ id, credential_version: 1, is_default: true }],
    expected: false,
  },
  {
    action: 'providers.deleteProvider',
    before: [{ kind: 'credential', detail: { id, version: 1 } }],
    after: [],
    expected: true,
  },
])(
  'credentialChanged reflects safe snapshots for $action ($expected)',
  async ({ action, before, after, expected }) => {
    let snapshots = 0;
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM auth_sessions')) return { rows: [{ id }] };
      if (
        sql.includes('credential_version') ||
        sql.includes('WITH applications')
      ) {
        snapshots += 1;
        return { rows: snapshots === 1 ? before : after };
      }
      return { rows: [] };
    });
    jest.mocked(getPgPool).mockReturnValue({
      connect: async () => ({ query, release: jest.fn() }),
    } as never);
    const response = await runAuditedAdminMutation(
      {
        ...input,
        action,
        payload: {
          id,
          updates: { key_value: 'synthetic-unchanged-ciphertext' },
        },
      },
      async () => toSuccessResponse(null)
    );
    expect(response.statusCode).toBe(200);
    const audit = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO admin_audit_events')
    );
    const values = (audit as unknown as [string, unknown[]])[1];
    expect(JSON.parse(values[7] as string)).toMatchObject({
      credentialChanged: expected,
    });
    expect(JSON.stringify(values)).not.toContain(
      'synthetic-unchanged-ciphertext'
    );
  }
);
