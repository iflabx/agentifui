/** @jest-environment node */
import Fastify from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { adminUsersForGroupRoutes } from './admin-users-for-group';

jest.mock('../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
}));
jest.mock('../lib/session-identity', () => ({
  resolveIdentityFromSession: jest.fn(),
}));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(resolveIdentityFromSession).mockResolvedValue({
    kind: 'ok',
    identity: { userId: 'admin', role: 'admin' },
  });
});

describe('actual group member candidate endpoint', () => {
  it.each([
    ['alice_1', '%alice\\_1%'],
    ['100%', '%100\\%%'],
    ['path\\name', '%path\\\\name%'],
    ['  mixed_%\\  ', '%mixed\\_\\%\\\\%'],
  ])(
    'escapes the literal search %s in both count and rows',
    async (search, pattern) => {
      const calls: { sql: string; params: unknown[] }[] = [];
      jest
        .mocked(queryRowsWithPgSystemContext)
        .mockImplementation(async (sql, params) => {
          calls.push({ sql, params: [...(params || [])] });
          return sql.includes('COUNT(*)')
            ? [{ total: '1' }]
            : [
                {
                  id: 'candidate',
                  username: search.trim(),
                  role: 'user',
                  status: 'active',
                },
              ];
        });
      const app = Fastify({ logger: false });
      await app.register(adminUsersForGroupRoutes, {
        config: {} as ApiRuntimeConfig,
      });
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/admin/users/for-group',
          payload: {
            page: 2,
            pageSize: 5,
            search,
            excludeUserIds: ['existing', null, ''],
          },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          success: true,
          total: 1,
          users: [{ id: 'candidate', username: search.trim() }],
        });
        expect(calls).toHaveLength(2);
        expect(calls[0].params).toEqual([pattern, ['existing']]);
        expect(calls[1].params).toEqual([pattern, ['existing'], 5, 5]);
        for (const { sql } of calls) {
          for (const column of ['username', 'full_name', 'email']) {
            expect(sql).toContain(`${column} ILIKE $1 ESCAPE E'\\\\'`);
          }
          expect(sql).toContain('NOT (id = ANY($2::uuid[]))');
          expect(sql).toContain("status = 'active'");
        }
      } finally {
        await app.close();
      }
    }
  );

  it('does not read candidates for a non-admin', async () => {
    jest.mocked(resolveIdentityFromSession).mockResolvedValueOnce({
      kind: 'ok',
      identity: { userId: 'user', role: 'user' },
    });
    const app = Fastify({ logger: false });
    await app.register(adminUsersForGroupRoutes, {
      config: {} as ApiRuntimeConfig,
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/users/for-group',
        payload: { search: '%' },
      });
      expect(response.statusCode).toBe(403);
      expect(queryRowsWithPgSystemContext).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
