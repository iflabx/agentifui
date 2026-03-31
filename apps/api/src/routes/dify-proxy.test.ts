/** @jest-environment node */
import Fastify from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { difyProxyRoutes } from './dify-proxy';
import { handleDifyProxy } from './dify-proxy-route/handler';
import { handleDifyResilienceOps } from './dify-proxy-route/ops-route';

jest.mock('./dify-proxy-route/handler', () => ({
  handleDifyProxy: jest.fn(),
}));

jest.mock('./dify-proxy-route/ops-route', () => ({
  handleDifyResilienceOps: jest.fn(),
}));

const ROUTE_SHELL_TEST_TIMEOUT_MS = 15_000;

function createConfig(
  overrides: Partial<ApiRuntimeConfig> = {}
): ApiRuntimeConfig {
  return {
    host: '127.0.0.1',
    port: 3010,
    logLevel: 'silent',
    nextUpstreamBaseUrl: 'http://127.0.0.1:3000',
    proxyPrefixes: ['/api/internal/data'],
    realtimeSourceMode: 'db-outbox',
    sessionCookieNames: ['session_token'],
    internalDataProxyTimeoutMs: 30000,
    difyTempConfigEnabled: false,
    difyTempConfigAllowedHosts: [],
    difyTempConfigAllowPrivate: false,
    inputModeration: {
      enabled: false,
      app: null,
    },
    ...overrides,
  };
}

async function createApp(configOverrides: Partial<ApiRuntimeConfig> = {}) {
  const app = Fastify({ logger: false });
  await app.register(difyProxyRoutes, {
    config: createConfig(configOverrides),
  });
  return app;
}

describe('dify proxy route shell', () => {
  const mockedHandleDifyProxy = handleDifyProxy as jest.MockedFunction<
    typeof handleDifyProxy
  >;
  const mockedHandleDifyResilienceOps =
    handleDifyResilienceOps as jest.MockedFunction<
      typeof handleDifyResilienceOps
    >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedHandleDifyProxy.mockImplementation(async (_request, reply) => {
      return reply.status(202).send({ ok: true, route: 'proxy' });
    });
    mockedHandleDifyResilienceOps.mockImplementation(
      async (_request, reply) => {
        return reply.send({ ok: true, route: 'ops' });
      }
    );
  });

  it(
    'dispatches proxy requests to the extracted handler',
    async () => {
      const app = await createApp();

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/dify/app-1/chat-messages',
          payload: { hello: 'world' },
        });

        expect(response.statusCode).toBe(202);
        expect(response.json()).toEqual({ ok: true, route: 'proxy' });
        expect(mockedHandleDifyProxy).toHaveBeenCalledTimes(1);
        expect(mockedHandleDifyResilienceOps).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
    ROUTE_SHELL_TEST_TIMEOUT_MS
  );

  it(
    'dispatches resilience ops requests to the extracted handler',
    async () => {
      const app = await createApp();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/internal/ops/dify-resilience?circuitKey=test-key',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ ok: true, route: 'ops' });
        expect(mockedHandleDifyResilienceOps).toHaveBeenCalledTimes(1);
        expect(mockedHandleDifyProxy).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
    ROUTE_SHELL_TEST_TIMEOUT_MS
  );
});
