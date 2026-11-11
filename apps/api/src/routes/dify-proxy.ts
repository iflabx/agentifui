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

function resolveUploadBodyLimit(): number {
  const rawValue = process.env.DIFY_UPLOAD_MAX_BYTES;
  if (rawValue === undefined) {
    return 16 * 1024 * 1024;
  }

  const normalizedValue = rawValue.trim();
  const bodyLimit = Number(normalizedValue);
  if (
    !/^\d+$/.test(normalizedValue) ||
    !Number.isSafeInteger(bodyLimit) ||
    bodyLimit < 1024
  ) {
    throw new Error(
      'DIFY_UPLOAD_MAX_BYTES must be a decimal safe integer of at least 1024 bytes'
    );
  }
  return bodyLimit;
}

export const difyProxyRoutes: FastifyPluginAsync<
  DifyProxyRoutesOptions
> = async (app, options) => {
  const uploadBodyLimit = resolveUploadBodyLimit();

  app.get('/api/internal/ops/dify-resilience', async (request, reply) =>
    handleDifyResilienceOps(request, reply, options.config)
  );

  for (const slug of ['files/upload', 'audio-to-text']) {
    app.post(
      `/api/dify/:appId/${slug}`,
      { bodyLimit: uploadBodyLimit },
      async (request, reply) => {
        const params = request.params as Record<string, string>;
        params['*'] = slug;
        return handleDifyProxy(request, reply, options.config);
      }
    );
  }

  for (const url of ['/api/dify/:appId', '/api/dify/:appId/*']) {
    app.route({
      method: PROXY_METHODS,
      url,
      handler: async (request, reply) =>
        handleDifyProxy(request, reply, options.config),
    });
  }
};
