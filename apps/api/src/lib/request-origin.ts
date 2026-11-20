import type { FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';

export function isAllowedMutationOrigin(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): boolean {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  return [process.env.NEXT_PUBLIC_APP_URL, ...config.corsAllowedOrigins].some(
    value => {
      try {
        return Boolean(value) && new URL(value!).origin === origin;
      } catch {
        return false;
      }
    }
  );
}
