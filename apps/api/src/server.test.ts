/** @jest-environment node */
import type { ApiRuntimeConfig } from './config';
import { createApiServer } from './server';

function createConfig(
  overrides: Partial<ApiRuntimeConfig> = {}
): ApiRuntimeConfig {
  return {
    host: '127.0.0.1',
    port: 3010,
    logLevel: 'silent',
    nextUpstreamBaseUrl: 'http://127.0.0.1:3000',
    proxyPrefixes: ['/api/internal/apps', '/api/internal/profile'],
    realtimeSourceMode: 'db-outbox',
    sessionCookieNames: ['session_token'],
    internalDataProxyTimeoutMs: 30000,
    difyTempConfigEnabled: false,
    difyTempConfigAllowedHosts: [],
    difyTempConfigAllowPrivate: false,
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
