import replyFrom from '@fastify/reply-from';
import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  HTTPMethods,
} from 'fastify';

import type { ApiRuntimeConfig } from '../config';

interface ProxyFallbackRoutesOptions {
  config: ApiRuntimeConfig;
}

const PROXY_BYPASS_HEADER = 'x-agentifui-fastify-bypass';
const PROXY_METHODS: HTTPMethods[] = [
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
];

function buildUpstreamUrl(baseUrl: string, rawUrl: string): string {
  return new URL(rawUrl, baseUrl).toString();
}

function rewriteRequestHeaders(
  headers: Record<string, string | string[] | undefined>,
  upstreamBaseUrl: string
) {
  const rewritten = { ...headers };
  rewritten[PROXY_BYPASS_HEADER] = '1';
  rewritten.host = new URL(upstreamBaseUrl).host;
  return rewritten;
}

async function forwardToNext(
  request: FastifyRequest,
  reply: FastifyReply,
  config: ApiRuntimeConfig
) {
  const rawUrl = request.raw.url || request.url;
  const targetUrl = buildUpstreamUrl(config.nextUpstreamBaseUrl, rawUrl);
  request.log.debug(
    { method: request.method, url: request.url, targetUrl },
    '[FastifyFallbackProxy] forwarding request to Next upstream'
  );
  return reply.from(targetUrl, {
    rewriteRequestHeaders: (_originRequest, headers) =>
      rewriteRequestHeaders(headers, config.nextUpstreamBaseUrl),
  });
}

export const proxyFallbackRoutes: FastifyPluginAsync<
  ProxyFallbackRoutesOptions
> = async (app, options) => {
  await app.register(replyFrom);

  for (const prefix of options.config.proxyPrefixes) {
    app.route({
      method: PROXY_METHODS,
      url: prefix,
      handler: async (request, reply) =>
        forwardToNext(request, reply, options.config),
    });
    app.route({
      method: PROXY_METHODS,
      url: `${prefix}/*`,
      handler: async (request, reply) =>
        forwardToNext(request, reply, options.config),
    });
  }
};
