import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  HTTPMethods,
} from 'fastify';
import { Readable } from 'node:stream';

import type { ApiRuntimeConfig } from '../config';
import {
  type AgentErrorSource,
  toUserFacingAgentError,
} from '../lib/agent-error';
import {
  REQUEST_ID_HEADER,
  buildApiErrorDetail,
  buildApiErrorEnvelope,
} from '../lib/app-error';
import { resolveDifyConfig } from '../lib/dify-config';
import {
  fetchWithDifyProxyResilience,
  getDifyProxyCircuitSnapshot,
  getDifyProxyResilienceMetricsSnapshot,
} from '../lib/dify-proxy-resilience';
import { recordApiErrorEvent } from '../lib/error-events';
import { buildRouteErrorPayload } from '../lib/route-error';
import { resolveIdentityFromSession } from '../lib/session-identity';

interface DifyProxyRoutesOptions {
  config: ApiRuntimeConfig;
}

type ErrorPayloadObject = Record<string, unknown>;

const PROXY_METHODS: HTTPMethods[] = [
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
];

function isObjectRecord(payload: unknown): payload is Record<string, unknown> {
  return (
    Boolean(payload) && typeof payload === 'object' && !Array.isArray(payload)
  );
}

function isWorkflowAppType(appType?: string): boolean {
  return (appType || '').trim().toLowerCase() === 'workflow';
}

function isTextGenerationAppType(appType?: string): boolean {
  return (appType || '').trim().toLowerCase() === 'text-generation';
}

function adjustApiPathByAppType(
  slug: string[],
  appType: string | undefined
): string {
  const originalPath = slug.join('/');

  if (!appType) {
    return originalPath;
  }

  if (isWorkflowAppType(appType)) {
    const commonApis = ['files/upload', 'audio-to-text'];
    const isCommonApi = commonApis.some(api => originalPath.startsWith(api));
    if (!isCommonApi && !originalPath.startsWith('workflows/')) {
      return `workflows/${originalPath}`;
    }
  }

  if (isTextGenerationAppType(appType)) {
    if (originalPath === 'messages' || originalPath === 'chat-messages') {
      return 'completion-messages';
    }
    if (originalPath.startsWith('chat-messages')) {
      return originalPath.replace('chat-messages', 'completion-messages');
    }
  }

  return originalPath;
}

function inferAgentSource(slugPath: string): AgentErrorSource {
  if (slugPath.startsWith('workflows/')) {
    return 'dify-workflow';
  }
  if (slugPath.startsWith('completion-messages')) {
    return 'dify-completion';
  }
  if (slugPath.startsWith('chat-messages')) {
    return 'dify-chat';
  }
  return 'agent-generic';
}

function extractErrorCode(payload: unknown): string | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  const maybeCode = payload.code;
  return typeof maybeCode === 'string' ? maybeCode : null;
}

function extractErrorMessage(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed || null;
  }

  if (!isObjectRecord(payload)) {
    return null;
  }

  const messageCandidates = [payload.message, payload.error, payload.details];
  for (const candidate of messageCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  const nestedData = payload.data;
  if (isObjectRecord(nestedData)) {
    const status = nestedData.status;
    if (status === 'failed') {
      const nestedError = nestedData.error;
      if (typeof nestedError === 'string' && nestedError.trim().length > 0) {
        return nestedError.trim();
      }
    }
  }

  return null;
}

function resolveRequestLocale(request: FastifyRequest): string | undefined {
  const languageHeader = request.headers['accept-language'];
  const rawValue =
    typeof languageHeader === 'string'
      ? languageHeader
      : Array.isArray(languageHeader)
        ? languageHeader[0]
        : '';

  if (!rawValue) {
    return undefined;
  }

  const firstItem = rawValue.split(',')[0]?.trim();
  return firstItem || undefined;
}

function extractRoutePath(
  rawUrl: string | undefined,
  fallback: string
): string {
  if (!rawUrl) {
    return fallback;
  }
  const index = rawUrl.indexOf('?');
  if (index < 0) {
    return rawUrl;
  }
  return rawUrl.slice(0, index);
}

function extractRawQuery(rawUrl: string | undefined): string {
  if (!rawUrl) {
    return '';
  }
  const index = rawUrl.indexOf('?');
  if (index < 0) {
    return '';
  }
  return rawUrl.slice(index);
}

function isMediaContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.startsWith('audio/') ||
    normalized.startsWith('video/') ||
    normalized.startsWith('image/') ||
    normalized.startsWith('application/pdf') ||
    normalized.startsWith('application/octet-stream')
  );
}

function copyHeaders(
  reply: FastifyReply,
  source: Headers,
  allow: (key: string) => boolean
): void {
  source.forEach((value, key) => {
    if (allow(key.toLowerCase())) {
      reply.header(key, value);
    }
  });
}

async function withAgentErrorEnvelope(
  payload: unknown,
  context: {
    source: AgentErrorSource;
    status: number;
    locale?: string;
    requestId: string;
    route: string;
    method: string;
    actorUserId?: string;
  }
): Promise<unknown> {
  const rawMessage = extractErrorMessage(payload);
  if (!rawMessage) {
    return payload;
  }

  const agentError = toUserFacingAgentError({
    source: context.source,
    status: context.status,
    code: extractErrorCode(payload),
    message: rawMessage,
    locale: context.locale,
  });
  const appError = buildApiErrorDetail({
    status: context.status,
    code: agentError.code,
    source: 'dify-proxy',
    requestId: context.requestId,
    userMessage: agentError.userMessage,
    developerMessage: rawMessage,
    retryable: agentError.retryable,
    context: {
      agent_source: agentError.source,
      agent_kind: agentError.kind,
      suggestion: agentError.suggestion,
    },
  });

  const appEnvelope = buildApiErrorEnvelope(appError, rawMessage);
  void recordApiErrorEvent({
    detail: appError,
    statusCode: context.status,
    method: context.method,
    route: context.route,
    actorUserId: context.actorUserId,
  }).catch(error => {
    console.warn(
      '[FastifyDifyProxy] failed to record error event:',
      error instanceof Error ? error.message : String(error)
    );
  });

  const normalizedPayload = isObjectRecord(payload)
    ? payload
    : {
        success: false,
        error: rawMessage,
      };

  return {
    ...normalizedPayload,
    ...appEnvelope,
    agent_error: agentError,
  };
}

function buildAppErrorPayload(input: {
  request: FastifyRequest;
  status: number;
  source: AgentErrorSource;
  route: string;
  method: string;
  actorUserId?: string;
  code: string;
  message: string;
}): Promise<unknown> {
  return withAgentErrorEnvelope(
    {
      code: input.code,
      error: input.message,
      message: input.message,
    },
    {
      source: input.source,
      status: input.status,
      locale: resolveRequestLocale(input.request),
      requestId: input.request.id,
      route: input.route,
      method: input.method,
      actorUserId: input.actorUserId,
    }
  );
}

function normalizeRequestBody(payload: unknown): BodyInit | null {
  if (payload === null || typeof payload === 'undefined') {
    return null;
  }
  if (Buffer.isBuffer(payload)) {
    return payload;
  }
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (typeof payload === 'string') {
    return payload;
  }
  if (isObjectRecord(payload) || Array.isArray(payload)) {
    return JSON.stringify(payload);
  }
  return null;
}

async function handleDifyProxy(
  request: FastifyRequest,
  reply: FastifyReply,
  config: ApiRuntimeConfig
): Promise<void> {
  reply.header(REQUEST_ID_HEADER, request.id);

  if (request.method === 'OPTIONS') {
    reply.status(204).send();
    return;
  }

  const params = request.params as Record<string, string | undefined>;
  const appId = (params.appId || '').trim();
  const wildcard = (params['*'] || '').trim();
  const slug = wildcard.length > 0 ? wildcard.split('/').filter(Boolean) : [];

  const routePath = extractRoutePath(request.raw.url, request.url);
  const requestLocale = resolveRequestLocale(request);

  if (!appId) {
    reply.status(400).send(
      buildRouteErrorPayload({
        request,
        statusCode: 400,
        source: 'dify-proxy',
        code: 'DIFY_PROXY_APP_ID_MISSING',
        userMessage: 'Missing appId',
      })
    );
    return;
  }

  if (slug.length === 0) {
    reply.status(400).send(
      buildRouteErrorPayload({
        request,
        statusCode: 400,
        source: 'dify-proxy',
        code: 'DIFY_PROXY_SLUG_MISSING',
        userMessage: 'Invalid request: slug path is missing',
      })
    );
    return;
  }

  const identity = await resolveIdentityFromSession(request, config);
  if (identity.kind === 'unauthorized') {
    const payload = await buildAppErrorPayload({
      request,
      status: 401,
      source: 'agent-generic',
      route: routePath,
      method: request.method,
      code: 'AUTH_UNAUTHORIZED',
      message: 'Unauthorized',
    });
    reply.status(401).send(payload);
    return;
  }

  if (identity.kind === 'error') {
    const payload = await buildAppErrorPayload({
      request,
      status: 500,
      source: 'agent-generic',
      route: routePath,
      method: request.method,
      code: 'AUTH_VERIFY_FAILED',
      message: 'Failed to verify session identity',
    });
    reply.status(500).send(payload);
    return;
  }

  const actor = identity.identity;
  const rawBody = request.body;
  let tempConfig: { apiUrl: string; apiKey: string } | null = null;

  if (request.method === 'POST' && isObjectRecord(rawBody)) {
    const maybeTemp = rawBody._temp_config;
    if (isObjectRecord(maybeTemp)) {
      const apiUrl =
        typeof maybeTemp.apiUrl === 'string' ? maybeTemp.apiUrl.trim() : '';
      const apiKey =
        typeof maybeTemp.apiKey === 'string' ? maybeTemp.apiKey.trim() : '';
      if (apiUrl && apiKey) {
        tempConfig = { apiUrl, apiKey };
      }
    }
  }

  let difyApiKey = '';
  let difyApiUrl = '';
  let appType: string | undefined;

  if (tempConfig) {
    difyApiKey = tempConfig.apiKey;
    difyApiUrl = tempConfig.apiUrl;
  } else {
    const difyConfig = await resolveDifyConfig(appId, {
      actorUserId: actor.userId,
      actorRole: actor.role,
    });

    if (!difyConfig) {
      const payload = await buildAppErrorPayload({
        request,
        status: 400,
        source: 'agent-generic',
        route: routePath,
        method: request.method,
        actorUserId: actor.userId,
        code: 'DIFY_CONFIG_NOT_FOUND',
        message: `Configuration for Dify app '${appId}' not found`,
      });
      reply.status(400).send(payload);
      return;
    }

    difyApiKey = difyConfig.apiKey;
    difyApiUrl = difyConfig.apiUrl;
    appType = difyConfig.appType;
  }

  if (!difyApiKey || !difyApiUrl) {
    const payload = await buildAppErrorPayload({
      request,
      status: 500,
      source: 'agent-generic',
      route: routePath,
      method: request.method,
      actorUserId: actor.userId,
      code: 'DIFY_CONFIG_INVALID',
      message: `Server configuration error for app '${appId}'`,
    });
    reply.status(500).send(payload);
    return;
  }

  const slugPath = adjustApiPathByAppType(slug, appType);
  const agentSource = inferAgentSource(slugPath);
  const rawQuery = extractRawQuery(request.raw.url);
  const targetUrl = `${difyApiUrl.replace(/\/+$/, '')}/${slugPath}${rawQuery}`;

  const upstreamHeaders = new Headers();
  const originalContentType =
    typeof request.headers['content-type'] === 'string'
      ? request.headers['content-type']
      : undefined;
  const acceptHeader =
    typeof request.headers.accept === 'string'
      ? request.headers.accept
      : undefined;

  if (originalContentType) {
    upstreamHeaders.set('Content-Type', originalContentType);
  }
  if (acceptHeader) {
    upstreamHeaders.set('Accept', acceptHeader);
  }
  upstreamHeaders.set('Authorization', `Bearer ${difyApiKey}`);

  const actualMethod = tempConfig ? 'GET' : request.method;
  const finalBody =
    actualMethod === 'GET' || actualMethod === 'HEAD'
      ? null
      : normalizeRequestBody(rawBody);

  if (
    finalBody &&
    typeof finalBody === 'string' &&
    !upstreamHeaders.has('Content-Type')
  ) {
    upstreamHeaders.set('Content-Type', 'application/json');
  }

  const clientAbortController = new AbortController();
  const handleClientAbort = () => {
    clientAbortController.abort();
  };
  request.raw.once('aborted', handleClientAbort);
  request.raw.once('close', handleClientAbort);

  try {
    const resilienceResult = await fetchWithDifyProxyResilience({
      circuitKey: `${appId}:${difyApiUrl}`,
      requestSignal: clientAbortController.signal,
      execute: async signal => {
        const requestInit: RequestInit = {
          method: actualMethod,
          headers: upstreamHeaders,
          redirect: 'manual',
          cache: 'no-store',
          signal,
        };
        if (finalBody) {
          requestInit.body = finalBody;
        }
        return fetch(targetUrl, requestInit);
      },
    });

    if (!resilienceResult.ok) {
      if (resilienceResult.reason === 'circuit-open') {
        const payload = await buildAppErrorPayload({
          request,
          status: 503,
          source: agentSource,
          route: routePath,
          method: request.method,
          actorUserId: actor.userId,
          code: 'DIFY_CIRCUIT_OPEN',
          message:
            'Dify upstream is temporarily unavailable. Please retry later.',
        });

        if (
          typeof resilienceResult.retryAfterSeconds === 'number' &&
          resilienceResult.retryAfterSeconds > 0
        ) {
          reply.header(
            'Retry-After',
            String(resilienceResult.retryAfterSeconds)
          );
        }
        reply.status(503).send(payload);
        return;
      }

      if (resilienceResult.reason === 'timeout') {
        const payload = await buildAppErrorPayload({
          request,
          status: 504,
          source: agentSource,
          route: routePath,
          method: request.method,
          actorUserId: actor.userId,
          code: 'DIFY_UPSTREAM_TIMEOUT',
          message: 'Dify upstream request timed out.',
        });
        reply.status(504).send(payload);
        return;
      }

      if (resilienceResult.reason === 'client-abort') {
        reply.status(499).send();
        return;
      }

      throw (
        resilienceResult.error ||
        new Error('Failed to connect to Dify upstream')
      );
    }

    const upstream = resilienceResult.response;

    if (upstream.status === 204) {
      copyHeaders(reply, upstream.headers, key => {
        return ![
          'content-length',
          'content-type',
          'transfer-encoding',
        ].includes(key);
      });
      reply.status(204).send();
      return;
    }

    const responseContentType = (
      upstream.headers.get('content-type') || ''
    ).toLowerCase();

    if (upstream.body && responseContentType.includes('text/event-stream')) {
      copyHeaders(reply, upstream.headers, key => {
        return (
          key === 'content-type' ||
          key === 'cache-control' ||
          key === 'connection'
        );
      });
      reply.status(upstream.status);
      reply.send(Readable.fromWeb(upstream.body as never));
      return;
    }

    if (upstream.body && isMediaContentType(responseContentType)) {
      copyHeaders(reply, upstream.headers, key => {
        return (
          key.startsWith('content-') ||
          key === 'accept-ranges' ||
          key === 'vary'
        );
      });
      reply.status(upstream.status);
      reply.send(Readable.fromWeb(upstream.body as never));
      return;
    }

    const responseData = await upstream.text();

    try {
      const jsonData = JSON.parse(responseData);
      const normalizedPayload = await withAgentErrorEnvelope(jsonData, {
        source: agentSource,
        status: upstream.status,
        locale: requestLocale,
        requestId: request.id,
        route: routePath,
        method: request.method,
        actorUserId: actor.userId,
      });
      reply
        .type('application/json')
        .status(upstream.status)
        .send(normalizedPayload);
      return;
    } catch {
      if (upstream.ok) {
        reply
          .type(upstream.headers.get('content-type') || 'text/plain')
          .status(upstream.status)
          .send(responseData);
        return;
      }

      const normalizedPayload = await withAgentErrorEnvelope(responseData, {
        source: agentSource,
        status: upstream.status,
        locale: requestLocale,
        requestId: request.id,
        route: routePath,
        method: request.method,
        actorUserId: actor.userId,
      });
      reply
        .type('application/json')
        .status(upstream.status)
        .send(normalizedPayload);
      return;
    }
  } catch (error) {
    request.log.error({ err: error }, '[FastifyDifyProxy] request failed');

    const payload = await withAgentErrorEnvelope(
      {
        code: 'DIFY_PROXY_UPSTREAM_ERROR',
        error: `Failed to connect or process response from Dify service for app '${appId}'`,
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      {
        source: 'agent-generic',
        status: 502,
        locale: requestLocale,
        requestId: request.id,
        route: routePath,
        method: request.method,
        actorUserId: actor.userId,
      }
    );

    reply.status(502).send(payload);
  } finally {
    request.raw.removeListener('aborted', handleClientAbort);
    request.raw.removeListener('close', handleClientAbort);
  }
}

export const difyProxyRoutes: FastifyPluginAsync<
  DifyProxyRoutesOptions
> = async (app, options) => {
  app.get('/api/internal/ops/dify-resilience', async (request, reply) => {
    const identity = await resolveIdentityFromSession(request, options.config);
    if (identity.kind !== 'ok') {
      return reply.status(401).send(
        buildRouteErrorPayload({
          request,
          statusCode: 401,
          source: 'auth',
          code: 'AUTH_UNAUTHORIZED',
          userMessage: 'Unauthorized',
        })
      );
    }

    if (identity.identity.role !== 'admin') {
      return reply.status(403).send(
        buildRouteErrorPayload({
          request,
          statusCode: 403,
          source: 'auth',
          code: 'AUTH_FORBIDDEN',
          userMessage: 'Forbidden',
        })
      );
    }

    const circuitKey = (
      request.query as Record<string, string | undefined>
    )?.circuitKey?.trim();

    return reply.send({
      success: true,
      metrics: {
        local: getDifyProxyResilienceMetricsSnapshot(),
        shared: null,
        sharedEnabled: false,
      },
      circuit: circuitKey
        ? {
            key: circuitKey,
            local: getDifyProxyCircuitSnapshot(circuitKey),
            shared: null,
          }
        : null,
    });
  });

  for (const url of ['/api/dify/:appId', '/api/dify/:appId/*']) {
    app.route({
      method: PROXY_METHODS,
      url,
      handler: async (request, reply) =>
        handleDifyProxy(request, reply, options.config),
    });
  }
};
