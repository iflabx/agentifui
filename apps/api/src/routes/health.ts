import type { FastifyPluginAsync } from 'fastify';

import type { ApiRuntimeConfig } from '../config';

interface HealthRoutesOptions {
  config: ApiRuntimeConfig;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (
  app,
  options
) => {
  app.get('/healthz', async () => {
    return {
      ok: true,
      service: 'agentifui-fastify-api',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/api/internal/fastify-health', async () => {
    return {
      success: true,
      data: {
        service: 'agentifui-fastify-api',
        nextUpstreamBaseUrl: options.config.nextUpstreamBaseUrl,
        proxyPrefixes: options.config.proxyPrefixes,
        realtimeSourceMode: options.config.realtimeSourceMode,
      },
    };
  });
};
