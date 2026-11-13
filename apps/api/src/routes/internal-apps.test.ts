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

describe('LangChain application metadata boundary', () => {
  const row = {
    id: 'app',
    provider_id: 'provider',
    instance_id: 'agent',
    display_name: 'Agent',
    visibility: 'public',
    api_path: '/private/agent',
    config: {
      backend_type: 'langchain',
      api_url: 'http://private.invalid',
      api_key: 'hidden',
      langchain: {
        assistant_id: 'agent',
        token: 'hidden',
        endpoint: 'http://private.invalid',
        capabilities: { streaming: true, cancellation: false, token: 'hidden' },
      },
      app_metadata: {
        brief_description: 'Safe description',
        tags: ['chat'],
        secret: 'hidden',
      },
    },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(queryRowsWithPgSystemContext).mockResolvedValue([row]);
    jest.mocked(queryRowsWithPgUserContext).mockResolvedValue([row]);
    jest.mocked(resolveIdentityFromSession).mockResolvedValue({
      kind: 'ok',
      identity: { userId: 'actor', role: 'admin' },
    });
  });

  it.each([
    'scope=public',
    'scope=public&mode=default',
    'scope=public&instanceId=agent',
    'scope=all&instanceId=agent',
    'mode=default',
  ])(
    'only exposes allowlisted LangChain display configuration for %s',
    async query => {
      const app = Fastify({ logger: false });
      await app.register(internalAppsRoutes, {
        config: {} as ApiRuntimeConfig,
      });
      try {
        const response = await app.inject(`/api/internal/apps?${query}`);
        expect(response.statusCode).toBe(200);
        const body = response.json();
        const result = body.app || body.apps[0];
        expect(result.config).toEqual({
          backend_type: 'langchain',
          langchain: {
            assistant_id: 'agent',
            capabilities: { streaming: true, cancellation: false },
          },
          app_metadata: {
            brief_description: 'Safe description',
            tags: ['chat'],
          },
        });
        expect(response.body).not.toContain('hidden');
        expect(response.body).not.toContain('private.invalid');
        expect(response.body).not.toContain('/private/agent');
      } finally {
        await app.close();
      }
    }
  );

  it('keeps legacy Dify public configuration unchanged', async () => {
    const legacy = {
      ...row,
      config: { dify_parameters: { opening_statement: 'Hello' } },
    };
    jest.mocked(queryRowsWithPgSystemContext).mockResolvedValueOnce([legacy]);
    const app = Fastify({ logger: false });
    await app.register(internalAppsRoutes, { config: {} as ApiRuntimeConfig });
    try {
      const response = await app.inject(
        '/api/internal/apps?scope=public&mode=default'
      );
      expect(response.json().app.config).toEqual(legacy.config);
      expect(response.json().app.api_path).toBe(legacy.api_path);
    } finally {
      await app.close();
    }
  });
});
