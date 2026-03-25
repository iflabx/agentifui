import type { FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../../config';
import { buildRouteErrorPayload } from '../../lib/route-error';
import { resolveIdentityFromSession } from '../../lib/session-identity';
import { buildAppErrorPayload } from './error-handling';
import { extractRoutePath, resolveRequestLocale } from './helpers';
import type { DifyProxyRequestContext } from './types';

export async function resolveProxyRequestContext(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<
  | { ok: true; context: DifyProxyRequestContext }
  | { ok: false; status: number; payload: unknown }
> {
  const params = request.params as Record<string, string | undefined>;
  const appId = (params.appId || '').trim();
  const wildcard = (params['*'] || '').trim();
  const slug = wildcard.length > 0 ? wildcard.split('/').filter(Boolean) : [];
  const routePath = extractRoutePath(request.raw.url, request.url);
  const requestLocale = resolveRequestLocale(
    request.headers['accept-language']
  );

  if (!appId) {
    return {
      ok: false,
      status: 400,
      payload: buildRouteErrorPayload({
        request,
        statusCode: 400,
        source: 'dify-proxy',
        code: 'DIFY_PROXY_APP_ID_MISSING',
        userMessage: 'Missing appId',
      }),
    };
  }

  if (slug.length === 0) {
    return {
      ok: false,
      status: 400,
      payload: buildRouteErrorPayload({
        request,
        statusCode: 400,
        source: 'dify-proxy',
        code: 'DIFY_PROXY_SLUG_MISSING',
        userMessage: 'Invalid request: slug path is missing',
      }),
    };
  }

  const identity = await resolveIdentityFromSession(request, config);
  if (identity.kind === 'unauthorized') {
    return {
      ok: false,
      status: 401,
      payload: await buildAppErrorPayload({
        request,
        status: 401,
        source: 'agent-generic',
        route: routePath,
        method: request.method,
        code: 'AUTH_UNAUTHORIZED',
        message: 'Unauthorized',
      }),
    };
  }

  if (identity.kind === 'error') {
    return {
      ok: false,
      status: 500,
      payload: await buildAppErrorPayload({
        request,
        status: 500,
        source: 'agent-generic',
        route: routePath,
        method: request.method,
        code: 'AUTH_VERIFY_FAILED',
        message: 'Failed to verify session identity',
      }),
    };
  }

  return {
    ok: true,
    context: {
      appId,
      slug,
      routePath,
      requestLocale,
      actor: identity.identity,
    },
  };
}
