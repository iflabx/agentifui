import type { FastifyPluginAsync, HTTPMethods } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { handleDifyProxy } from './dify-proxy-route/handler';
import { handleDifyResilienceOps } from './dify-proxy-route/ops-route';

interface DifyProxyRoutesOptions {
  config: ApiRuntimeConfig;
}

const PROXY_METHODS: HTTPMethods[] = [
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
];

export const difyProxyRoutes: FastifyPluginAsync<
  DifyProxyRoutesOptions
> = async (app, options) => {
  app.get('/api/internal/ops/dify-resilience', async (request, reply) =>
    handleDifyResilienceOps(request, reply, options.config)
  );

  for (const url of ['/api/dify/:appId', '/api/dify/:appId/*']) {
    app.route({
      method: PROXY_METHODS,
      url,
      handler: async (request, reply) =>
        handleDifyProxy(request, reply, options.config),
    });
  }
};
