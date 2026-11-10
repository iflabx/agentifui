/** @jest-environment node */
import Fastify from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import {
  queryRowsWithPgSystemContext,
  queryRowsWithPgUserContext,
} from '../lib/pg-context';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { internalAppsRoutes } from './internal-apps';

jest.mock('../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
  queryRowsWithPgUserContext: jest.fn(),
}));
jest.mock('../lib/session-identity', () => ({
  resolveIdentityFromSession: jest.fn(),
}));

describe('default app visibility', () => {
  it.each(['private', 'group_only', 'public'])(
    'enforces the public predicate for a %s default app',
    async visibility => {
      const row = {
        id: 'app',
        provider_id: 'provider',
        visibility,
        config: { internal: 'private setting' },
      };
      jest
        .mocked(queryRowsWithPgSystemContext)
        .mockImplementation(async sql => {
          const restricted = sql.includes("si.visibility = 'public'");
          return restricted && visibility !== 'public' ? [] : [row];
        });
      const app = Fastify({ logger: false });
      await app.register(internalAppsRoutes, {
        config: {} as ApiRuntimeConfig,
      });
      try {
        const response = await app.inject(
          '/api/internal/apps?scope=public&mode=default'
        );
        expect(response.statusCode).toBe(200);
        expect(response.json().app).toEqual(
          visibility === 'public'
            ? expect.objectContaining({ id: 'app' })
            : null
        );
        expect(queryRowsWithPgSystemContext).toHaveBeenCalledWith(
          expect.stringContaining("si.visibility = 'public'"),
          []
        );
        expect(resolveIdentityFromSession).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    }
  );

  it('selects an authenticated default app under the user RLS context', async () => {
    jest.mocked(resolveIdentityFromSession).mockResolvedValueOnce({
      kind: 'ok',
      identity: { userId: 'actor', role: 'user' },
    });
    jest.mocked(queryRowsWithPgUserContext).mockResolvedValueOnce([]);
    const app = Fastify({ logger: false });
    await app.register(internalAppsRoutes, { config: {} as ApiRuntimeConfig });
    try {
      const response = await app.inject('/api/internal/apps?mode=default');
      expect(response.statusCode).toBe(200);
      expect(queryRowsWithPgUserContext).toHaveBeenCalledWith(
        'actor',
        'user',
        expect.stringContaining('si.is_default = TRUE'),
        []
      );
      expect(queryRowsWithPgSystemContext).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
