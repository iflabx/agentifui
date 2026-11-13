/** @jest-environment node */
import type { ApiRuntimeConfig } from './config';
import { createApiServer } from './server';

jest.mock('./lib/error-events', () => ({
  recordApiErrorEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./routes/health', () => {
  const { healthRoutes } =
    jest.requireActual<typeof import('./routes/health')>('./routes/health');
  return {
    healthRoutes: async (
      ...pluginArguments: Parameters<typeof healthRoutes>
    ) => {
      await healthRoutes(...pluginArguments);
      const [app] = pluginArguments;
      app.get('/privacy-plugin-error', async () => {
        throw new Error('synthetic-private-plugin-exception');
      });
    },
  };
});

function createConfig(
  overrides: Partial<ApiRuntimeConfig> = {}
): ApiRuntimeConfig {
  return {
    host: '127.0.0.1',
    port: 3010,
    logLevel: 'silent',
    corsAllowedOrigins: ['https://stage.example:18021'],
    nextUpstreamBaseUrl: 'http://127.0.0.1:3000',
    proxyPrefixes: ['/api/internal/apps', '/api/internal/profile'],
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

describe('createApiServer realtime mode guard', () => {
  it('rejects app-direct mode for realtime-sensitive proxied routes', async () => {
    await expect(
      createApiServer(
        createConfig({
          realtimeSourceMode: 'app-direct',
        })
      )
    ).rejects.toThrow(/REALTIME_SOURCE_MODE=app-direct/);
  });

  it('allows db-outbox mode for realtime-sensitive proxied routes', async () => {
    const app = await createApiServer(createConfig());
    await app.close();
  });
});

describe('unhandled error privacy', () => {
  it('applies the safe handler to errors inside registered route plugins', async () => {
    const app = await createApiServer(createConfig());
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/privacy-plugin-error?private_marker=synthetic-private-query',
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('synthetic-private-plugin-exception');
      expect(response.body).not.toContain('synthetic-private-query');
      expect(response.json().request_id).toBeTruthy();
      expect(response.headers['x-request-id']).toBe(response.json().request_id);
    } finally {
      await app.close();
    }
  });

  it('applies the safe handler to malformed JSON on a registered business route', async () => {
    const app = await createApiServer(createConfig());
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/data?private_marker=synthetic-private-query',
        headers: { 'content-type': 'application/json' },
        payload: '{"synthetic-private-body":',
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('synthetic-private-body');
      expect(response.body).not.toContain('synthetic-private-query');
      expect(response.json().app_error).toMatchObject({
        source: 'fastify-api',
      });
      expect(response.json().request_id).toBeTruthy();
      expect(response.headers['x-request-id']).toBe(response.json().request_id);
    } finally {
      await app.close();
    }
  });

  it('returns a request identifier without exposing exception text', async () => {
    const app = await createApiServer(createConfig());
    const sensitiveValue = 'synthetic-private-exception-value';
    app.get('/privacy-error', async () => {
      throw new Error(`Authorization: Bearer ${sensitiveValue}`);
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/privacy-error',
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain(sensitiveValue);
      expect(response.json().request_id).toBeTruthy();
    } finally {
      await app.close();
    }
  });
});

describe('createApiServer CORS', () => {
  const allowedOrigin = 'https://stage.example:18021';

  it('allows a configured origin in credentialed preflight requests', async () => {
    const app = await createApiServer(createConfig());
    try {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/healthz',
        headers: {
          origin: allowedOrigin,
          'access-control-request-method': 'GET',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(
        allowedOrigin
      );
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await app.close();
    }
  });

  it.each([
    'https://untrusted.example',
    'https://stage.example',
    'http://stage.example:18021',
    'https://stage.example:18021.untrusted.example',
    'null',
  ])('does not authorize the unconfigured origin %s', async origin => {
    const app = await createApiServer(createConfig());
    try {
      for (const method of ['OPTIONS', 'GET'] as const) {
        const response = await app.inject({
          method,
          url: '/healthz',
          headers: {
            origin,
            ...(method === 'OPTIONS'
              ? { 'access-control-request-method': 'GET' }
              : {}),
          },
        });

        expect(response.headers['access-control-allow-origin']).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  });

  it('allows configured actual requests and preserves cache variation by origin', async () => {
    const app = await createApiServer(createConfig());
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin: allowedOrigin },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(
        allowedOrigin
      );
      expect(response.headers.vary).toContain('Origin');
    } finally {
      await app.close();
    }
  });

  it('keeps requests without Origin working without CORS authorization', async () => {
    const app = await createApiServer(createConfig());
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('does not authorize cross-origin requests when no origins are configured', async () => {
    const app = await createApiServer(createConfig({ corsAllowedOrigins: [] }));
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin: allowedOrigin },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
