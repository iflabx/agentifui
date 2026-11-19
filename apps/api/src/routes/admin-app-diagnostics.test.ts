/** @jest-environment node */
import Fastify from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { diagnoseApp } from '../lib/app-diagnostics';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { adminAppDiagnosticsRoutes } from './admin-app-diagnostics';

jest.mock('../lib/app-diagnostics', () => ({ diagnoseApp: jest.fn() }));
jest.mock('../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
}));
jest.mock('../lib/session-identity', () => ({
  resolveIdentityFromSession: jest.fn(),
}));

const providerId = '00000000-0000-4000-8000-000000000001';
const serviceInstanceId = '00000000-0000-4000-8000-000000000002';
const body = { providerId, backend: 'dify', apiKey: 'synthetic-key' };
async function request(payload: unknown = body) {
  const app = Fastify({ logger: false });
  await app.register(adminAppDiagnosticsRoutes, {
    config: {} as ApiRuntimeConfig,
  });
  try {
    return await app.inject({
      method: 'POST',
      url: '/api/admin/app-diagnostics',
      payload: payload as Record<string, unknown>,
    });
  } finally {
    await app.close();
  }
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(resolveIdentityFromSession).mockResolvedValue({
    kind: 'ok',
    identity: { userId: 'admin', role: 'admin' },
  });
  jest
    .mocked(queryRowsWithPgSystemContext)
    .mockResolvedValue([
      { base_url: 'https://trusted.example.test/v1', type: 'llm' },
    ]);
  jest.mocked(diagnoseApp).mockResolvedValue({
    status: 'success',
    code: 'connected',
    capabilities: [],
  });
});

it.each(['unauthorized', 'user', 'error'])(
  'rejects %s before resolving a target',
  async kind => {
    jest
      .mocked(resolveIdentityFromSession)
      .mockResolvedValue(
        kind === 'user'
          ? { kind: 'ok', identity: { userId: 'user', role: 'user' } }
          : kind === 'error'
            ? { kind: 'error', reason: 'private' }
            : { kind: 'unauthorized' }
      );
    expect((await request()).statusCode).toBe(
      kind === 'user' ? 403 : kind === 'error' ? 503 : 401
    );
    expect(queryRowsWithPgSystemContext).not.toHaveBeenCalled();
    expect(diagnoseApp).not.toHaveBeenCalled();
  }
);
it('uses only trusted provider URL and never writes configuration', async () => {
  const response = await request({
    ...body,
    baseUrl: 'https://untrusted.example.test',
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(diagnoseApp).toHaveBeenCalledWith(
    expect.objectContaining({
      baseUrl: 'https://trusted.example.test/v1',
      apiKey: 'synthetic-key',
    })
  );
  expect(queryRowsWithPgSystemContext).toHaveBeenCalledTimes(1);
  expect(queryRowsWithPgSystemContext).toHaveBeenCalledWith(
    expect.stringMatching(/^SELECT/),
    [providerId]
  );
  expect(response.body).not.toMatch(/trusted|synthetic/);
});
it('requires a credential for a new app', async () => {
  expect((await request({ providerId, backend: 'dify' })).json().code).toBe(
    'credentialsRequired'
  );
  expect(diagnoseApp).not.toHaveBeenCalled();
});
it('can check an unsaved draft using a saved credential without saving fields', async () => {
  jest
    .mocked(queryRowsWithPgSystemContext)
    .mockResolvedValueOnce([
      { base_url: 'https://trusted.example.test', type: 'langchain' },
    ])
    .mockResolvedValueOnce([
      {
        provider_id: providerId,
        config: {
          backend_type: 'langchain',
          langchain: { assistant_id: '../invalid-old-value' },
        },
        key_value: 'saved-key',
      },
    ]);
  await request({
    providerId,
    serviceInstanceId,
    backend: 'langchain',
    assistantId: 'draft-assistant',
  });
  expect(diagnoseApp).toHaveBeenCalledWith(
    expect.objectContaining({
      apiKey: 'saved-key',
      assistantId: 'draft-assistant',
    })
  );
  expect(queryRowsWithPgSystemContext).toHaveBeenLastCalledWith(
    expect.stringContaining("actor.status = 'active'"),
    [serviceInstanceId, 'admin']
  );
  for (const [sql] of jest.mocked(queryRowsWithPgSystemContext).mock.calls)
    expect(sql).toMatch(/^SELECT/);
});
it('does not forward saved keys to a different provider', async () => {
  jest
    .mocked(queryRowsWithPgSystemContext)
    .mockResolvedValueOnce([
      { base_url: 'https://trusted.example.test', type: 'llm' },
    ])
    .mockResolvedValueOnce([{ provider_id: 'different' }]);
  expect(
    (await request({ providerId, serviceInstanceId, backend: 'dify' })).json()
      .code
  ).toBe('invalidConfiguration');
  expect(diagnoseApp).not.toHaveBeenCalled();
});
it.each(['ftp://host', 'https://name:pass@host', 'https://host/?token=secret'])(
  'rejects invalid stored URL %s',
  async base_url => {
    jest
      .mocked(queryRowsWithPgSystemContext)
      .mockResolvedValue([{ base_url, type: 'llm' }]);
    expect((await request()).json().code).toBe('invalidConfiguration');
    expect(diagnoseApp).not.toHaveBeenCalled();
  }
);
it('does not probe a mismatching backend', async () => {
  expect(
    (
      await request({ ...body, backend: 'langchain', assistantId: 'agent' })
    ).json().code
  ).toBe('invalidConfiguration');
  expect(diagnoseApp).not.toHaveBeenCalled();
});
it('returns a safe failure if stored credential decryption fails', async () => {
  jest
    .mocked(queryRowsWithPgSystemContext)
    .mockResolvedValueOnce([
      { base_url: 'https://trusted.example.test', type: 'llm' },
    ])
    .mockResolvedValueOnce([
      {
        provider_id: providerId,
        config: { backend_type: 'dify' },
        key_value: 'invalid:encrypted:credential',
      },
    ]);
  const response = await request({
    providerId,
    serviceInstanceId,
    backend: 'dify',
  });
  expect(response.json()).toEqual({
    status: 'error',
    code: 'unavailable',
    capabilities: [],
  });
  expect(response.body).not.toContain('private');
});

it('does not reuse a saved credential for a different backend', async () => {
  jest
    .mocked(queryRowsWithPgSystemContext)
    .mockResolvedValueOnce([
      { base_url: 'https://trusted.example.test', type: 'llm' },
    ])
    .mockResolvedValueOnce([
      {
        provider_id: providerId,
        config: { backend_type: 'langchain' },
        key_value: 'saved-key',
      },
    ]);
  expect(
    (await request({ providerId, serviceInstanceId, backend: 'dify' })).json()
      .code
  ).toBe('invalidConfiguration');
  expect(diagnoseApp).not.toHaveBeenCalled();
});

it('preserves the runtime human-input priority when both switches are enabled', async () => {
  jest
    .mocked(queryRowsWithPgSystemContext)
    .mockResolvedValueOnce([
      { base_url: 'https://trusted.example.test', type: 'langchain' },
    ]);
  const response = await request({
    ...body,
    backend: 'langchain',
    assistantId: 'agent',
    humanInput: true,
    resultProfileEnabled: true,
  });
  expect(response.json().code).toBe('connected');
  expect(diagnoseApp).toHaveBeenCalledWith(
    expect.objectContaining({
      humanInput: true,
      resultProfileEnabled: true,
    })
  );
});
