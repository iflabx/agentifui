/** @jest-environment node */
import Fastify from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { resolveDifyConfig } from '../lib/dify-config';
import {
  normalizeDifyInputCapabilities,
  resolveDifyInputCapabilities,
} from '../lib/dify-input-capabilities';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { internalAppsRoutes } from './internal-apps';

jest.mock('../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
  queryRowsWithPgUserContext: jest.fn(),
}));
jest.mock('../lib/session-identity', () => ({
  resolveIdentityFromSession: jest.fn(),
}));
jest.mock('../lib/dify-config', () => ({ resolveDifyConfig: jest.fn() }));
jest.mock('../lib/dify-input-capabilities', () => ({
  ...jest.requireActual('../lib/dify-input-capabilities'),
  resolveDifyInputCapabilities: jest.fn(),
}));

const id = '20000000-0000-4000-8000-000000000001';
const url = `/api/internal/apps/${id}/input-capabilities`;
const server = () =>
  Fastify().register(internalAppsRoutes, { config: {} as ApiRuntimeConfig });
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(resolveIdentityFromSession).mockResolvedValue({
    kind: 'ok',
    identity: { userId: 'actor', role: 'user' },
  });
  jest
    .mocked(queryRowsWithPgSystemContext)
    .mockResolvedValue([{ instance_id: 'native-app', config: {} }]);
  jest.mocked(resolveDifyConfig).mockResolvedValue({
    serviceInstanceId: id,
    appId: 'native-app',
    apiUrl: 'https://agent.example/v1',
    apiKey: 'synthetic-private',
  });
  jest
    .mocked(resolveDifyInputCapabilities)
    .mockResolvedValue(normalizeDifyInputCapabilities({}));
});

it('requires a session before resolving upstream or reading the cache', async () => {
  jest
    .mocked(resolveIdentityFromSession)
    .mockResolvedValue({ kind: 'unauthorized' });
  const app = server();
  try {
    expect((await app.inject(url)).statusCode).toBe(401);
    expect(queryRowsWithPgSystemContext).not.toHaveBeenCalled();
    expect(resolveDifyInputCapabilities).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

it('does not treat a route instance name as a service UUID', async () => {
  const app = server();
  try {
    expect(
      (await app.inject('/api/internal/apps/native-name/input-capabilities'))
        .statusCode
    ).toBe(400);
  } finally {
    await app.close();
  }
});

it('checks active actor/provider and app visibility on every request, including a cached read', async () => {
  const app = server();
  try {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json()).toEqual(normalizeDifyInputCapabilities({}));
    expect(response.body).not.toContain('synthetic-private');
    expect(resolveDifyConfig).toHaveBeenCalledWith('native-app', {
      actorUserId: 'actor',
      actorRole: 'user',
      serviceInstanceId: id,
    });
    const sql = jest.mocked(queryRowsWithPgSystemContext).mock.calls[0][0];
    for (const predicate of [
      "actor.status = 'active'",
      "si.visibility = 'public'",
      'gap.is_enabled = TRUE',
      'p.is_active=TRUE',
    ])
      expect(sql).toContain(predicate);
    jest.mocked(queryRowsWithPgSystemContext).mockResolvedValue([]);
    expect((await app.inject(url)).statusCode).toBe(404);
    expect(resolveDifyInputCapabilities).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});

it('reports unavailable instead of an unlimited capability when configuration cannot be resolved', async () => {
  jest.mocked(resolveDifyConfig).mockResolvedValue(null);
  const app = server();
  try {
    expect((await app.inject(url)).json()).toMatchObject({
      status: 'unavailable',
      attachmentSlots: [],
    });
  } finally {
    await app.close();
  }
});
