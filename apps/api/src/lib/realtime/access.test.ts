import { queryRowsWithPgSystemContext } from '../pg-context';
import { projectAuthorizedRealtimeEvent } from './access';
import type { RealtimeEnvelope } from './contract';

jest.mock('../pg-context', () => ({ queryRowsWithPgSystemContext: jest.fn() }));
const actor = {
  userId: '10000000-0000-4000-8000-000000000001',
  authUserId: '10000000-0000-4000-8000-000000000001',
  role: 'user' as const,
};
const event = (
  table: string,
  row: Record<string, unknown>
): RealtimeEnvelope => ({
  id: '1-0',
  key: 'synthetic',
  emittedAt: 1,
  payload: {
    schema: 'public',
    table,
    eventType: 'UPDATE',
    commitTimestamp: '',
    new: row,
    old: null,
  },
});

test('public provider events and admin key events never include credentials/config', async () => {
  const result = await projectAuthorizedRealtimeEvent(
    event('providers', {
      id: actor.userId,
      name: 'Example',
      base_url: 'https://secret.invalid',
      key_value: 'synthetic-secret',
      config: { token: 'synthetic-secret' },
    }),
    actor
  );
  expect(result?.payload.new).toEqual({ id: actor.userId, name: 'Example' });
  const key = await projectAuthorizedRealtimeEvent(
    event('api_keys', {
      id: actor.userId,
      key_value: 'synthetic-secret',
      credential_version: 3,
    }),
    { ...actor, role: 'admin' }
  );
  expect(key?.payload.new).toEqual({ id: actor.userId, credential_version: 3 });
});

test('replay/live messages with revoked app access are dropped; own conversation receives only invalidation', async () => {
  jest.mocked(queryRowsWithPgSystemContext).mockResolvedValue([]);
  expect(
    await projectAuthorizedRealtimeEvent(
      event('messages', {
        conversation_id: actor.userId,
        content: 'private-body',
      }),
      actor
    )
  ).toBeNull();
  const invalidation = await projectAuthorizedRealtimeEvent(
    event('conversations', {
      id: actor.userId,
      user_id: actor.userId,
      title: 'private-title',
      status: 'active',
    }),
    actor
  );
  expect(invalidation?.payload.new).toEqual({
    id: actor.userId,
    user_id: actor.userId,
    status: 'active',
  });
  const sql = jest.mocked(queryRowsWithPgSystemContext).mock.calls[0][0];
  expect(sql).toContain('provider.is_active');
  expect(sql).toContain('group_app_permissions');
});

test('authorized owner subscriptions retain body but exclude unknown fields', async () => {
  jest
    .mocked(queryRowsWithPgSystemContext)
    .mockResolvedValue([{ id: actor.userId }]);
  const result = await projectAuthorizedRealtimeEvent(
    event('messages', {
      id: actor.userId,
      conversation_id: actor.userId,
      content: 'expected-body',
      headers: { authorization: 'synthetic-secret' },
    }),
    { ...actor, role: 'admin' }
  );
  expect(result?.payload.new).toEqual({
    id: actor.userId,
    conversation_id: actor.userId,
    content: 'expected-body',
  });
  const [sql, parameters, options] = jest
    .mocked(queryRowsWithPgSystemContext)
    .mock.calls.at(-1)!;
  expect(sql).not.toContain("$3::text='admin'");
  expect(parameters).toEqual([actor.userId, actor.userId]);
  expect(options).toEqual({ statementTimeoutMs: 5000 });
});
