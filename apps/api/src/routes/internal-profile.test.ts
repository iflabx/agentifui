/** @jest-environment node */
import Fastify from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { internalProfileRoutes } from './internal-profile';

jest.mock('../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
}));
jest.mock('../lib/session-identity', () => ({
  resolveIdentityFromSession: jest.fn(),
}));

describe('profile field ownership policy', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(resolveIdentityFromSession).mockResolvedValue({
      kind: 'ok',
      identity: { userId, role: 'user' },
    });
  });
  async function patch(
    updates: Record<string, unknown>,
    targetUserId = userId
  ) {
    const app = Fastify({ logger: false });
    await app.register(internalProfileRoutes, {
      config: {} as ApiRuntimeConfig,
    });
    try {
      return await app.inject({
        method: 'PATCH',
        url: '/api/internal/profile',
        payload: { updates, userId: targetUserId },
      });
    } finally {
      await app.close();
    }
  }

  it.each(['cas', 'oidc', 'github'])(
    'rejects managed %s names without writing even when mixed with editable fields',
    async authSource => {
      jest
        .mocked(queryRowsWithPgSystemContext)
        .mockResolvedValue([{ id: userId, auth_source: authSource }]);
      expect(
        (await patch({ full_name: 'Changed', username: 'new' })).statusCode
      ).toBe(400);
      expect(queryRowsWithPgSystemContext).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['better-auth', 'native', 'password'])(
    'allows names for local %s profiles',
    async authSource => {
      jest
        .mocked(queryRowsWithPgSystemContext)
        .mockResolvedValue([{ id: userId, auth_source: authSource }]);
      expect((await patch({ full_name: 'Changed' })).statusCode).toBe(200);
      expect(queryRowsWithPgSystemContext).toHaveBeenCalledWith(
        expect.stringContaining('SET full_name = $1'),
        expect.arrayContaining(['Changed', userId])
      );
    }
  );

  it('preserves username and avatar edits for managed accounts', async () => {
    jest
      .mocked(queryRowsWithPgSystemContext)
      .mockResolvedValue([{ id: userId, auth_source: 'cas' }]);
    expect(
      (await patch({ username: 'local-alias', avatar_url: null })).statusCode
    ).toBe(200);
  });

  it('does not let ordinary users edit another profile', async () => {
    expect((await patch({ username: 'alias' }, 'other-user')).statusCode).toBe(
      403
    );
    expect(queryRowsWithPgSystemContext).not.toHaveBeenCalled();
  });

  it('applies the target profile source policy to administrators as in user-actions', async () => {
    jest
      .mocked(resolveIdentityFromSession)
      .mockResolvedValue({ kind: 'ok', identity: { userId, role: 'admin' } });
    jest
      .mocked(queryRowsWithPgSystemContext)
      .mockResolvedValue([{ id: 'other-user', auth_source: 'cas' }]);
    expect(
      (await patch({ full_name: 'Changed' }, 'other-user')).statusCode
    ).toBe(400);
    expect((await patch({ username: 'Alias' }, 'other-user')).statusCode).toBe(
      200
    );
  });

  it('returns not found instead of writing a missing profile', async () => {
    jest.mocked(queryRowsWithPgSystemContext).mockResolvedValue([]);
    expect((await patch({ full_name: 'Changed' })).statusCode).toBe(404);
    expect(queryRowsWithPgSystemContext).toHaveBeenCalledTimes(1);
  });
});
