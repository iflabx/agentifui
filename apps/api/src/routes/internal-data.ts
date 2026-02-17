import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';

interface InternalDataRoutesOptions {
  config: ApiRuntimeConfig;
}

const FASTIFY_BYPASS_HEADER = 'x-agentifui-fastify-bypass';
const FORWARDED_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'x-requested-with',
] as const;

function buildUpstreamHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();

  for (const key of FORWARDED_HEADERS) {
    const value = request.headers[key];
    if (typeof value === 'string' && value.length > 0) {
      headers.set(key, value);
      continue;
    }
    if (Array.isArray(value) && value.length > 0) {
      headers.set(key, value.join(', '));
    }
  }

  headers.set(FASTIFY_BYPASS_HEADER, '1');
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return headers;
}

function normalizeRequestBody(body: unknown): string {
  if (typeof body === 'string') {
    return body;
  }

  if (body == null) {
    return '{}';
  }

  try {
    return JSON.stringify(body);
  } catch {
    return '{}';
  }
}

async function proxyInternalDataRequest(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<{ statusCode: number; payload: unknown }> {
  const targetUrl = new URL('/api/internal/data', config.nextUpstreamBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: buildUpstreamHeaders(request),
      body: normalizeRequestBody(request.body),
      signal: controller.signal,
    });

    const responseText = await response.text();

    if (!responseText.trim()) {
      return {
        statusCode: response.status,
        payload: {
          success: response.ok,
          error: response.ok ? null : 'Empty upstream response',
        },
      };
    }

    try {
      return {
        statusCode: response.status,
        payload: JSON.parse(responseText) as unknown,
      };
    } catch {
      return {
        statusCode: response.status,
        payload: {
          success: false,
          error: responseText,
        },
      };
    }
  } catch {
    return {
      statusCode: 502,
      payload: {
        success: false,
        error: 'Failed to proxy internal data action',
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const internalDataRoutes: FastifyPluginAsync<
  InternalDataRoutesOptions
> = async (app, options) => {
  app.post('/api/internal/data', async (request, reply) => {
    const result = await proxyInternalDataRequest(request, options.config);
    return reply.status(result.statusCode).send(result.payload);
  });
};
