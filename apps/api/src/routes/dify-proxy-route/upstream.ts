import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  fetchWithDifyProxyResilience,
  getDifyProxyCircuitSnapshot,
} from '../../lib/dify-proxy-resilience';
import {
  buildAppErrorPayload,
  logDifyProxyFailure,
  withAgentErrorEnvelope,
} from './error-handling';
import {
  adjustApiPathByAppType,
  copyHeaders,
  extractRawQuery,
  inferAgentSource,
  isMediaContentType,
  isReplyCommitted,
  normalizeRequestBody,
  resolveDifyProxyTimeoutMs,
} from './helpers';
import { sendUpstreamStream } from './stream';
import type { DifyProxyRequestContext, DifyProxyTargetConfig } from './types';

async function handleResilienceFailure(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  context: DifyProxyRequestContext;
  targetConfig: DifyProxyTargetConfig;
  slugPath: string;
  agentSource: ReturnType<typeof inferAgentSource>;
  routePath: string;
  resilienceResult: Awaited<
    ReturnType<typeof fetchWithDifyProxyResilience>
  > extends infer T
    ? T
    : never;
}): Promise<void> {
  const { request, reply, context, targetConfig, slugPath, agentSource } =
    input;
  const { resilienceResult } = input;

  if (!resilienceResult.ok && resilienceResult.reason === 'circuit-open') {
    logDifyProxyFailure(request, {
      appId: context.appId,
      routePath: context.routePath,
      slugPath,
      agentSource,
      failureKind: 'circuit-open',
      retryAfterSeconds: resilienceResult.retryAfterSeconds,
      elapsedMs: resilienceResult.elapsedMs,
    });

    const payload = await buildAppErrorPayload({
      request,
      status: 503,
      source: agentSource,
      route: context.routePath,
      method: request.method,
      actorUserId: context.actor.userId,
      code: 'DIFY_CIRCUIT_OPEN',
      message: 'Dify upstream is temporarily unavailable. Please retry later.',
    });

    if (
      typeof resilienceResult.retryAfterSeconds === 'number' &&
      resilienceResult.retryAfterSeconds > 0
    ) {
      reply.header('Retry-After', String(resilienceResult.retryAfterSeconds));
    }
    reply.status(503).send(payload);
    return;
  }

  if (!resilienceResult.ok && resilienceResult.reason === 'timeout') {
    logDifyProxyFailure(request, {
      appId: context.appId,
      routePath: context.routePath,
      slugPath,
      agentSource,
      failureKind: 'timeout',
      elapsedMs: resilienceResult.elapsedMs,
    });

    const payload = await buildAppErrorPayload({
      request,
      status: 504,
      source: agentSource,
      route: context.routePath,
      method: request.method,
      actorUserId: context.actor.userId,
      code: 'DIFY_UPSTREAM_TIMEOUT',
      message: 'Dify upstream request timed out.',
    });
    reply.status(504).send(payload);
    return;
  }

  if (!resilienceResult.ok && resilienceResult.reason === 'client-abort') {
    logDifyProxyFailure(request, {
      appId: context.appId,
      routePath: context.routePath,
      slugPath,
      agentSource,
      failureKind: 'client-abort',
      elapsedMs: resilienceResult.elapsedMs,
    });
    reply.status(499).send();
    return;
  }

  if (!resilienceResult.ok) {
    logDifyProxyFailure(request, {
      appId: context.appId,
      routePath: context.routePath,
      slugPath,
      agentSource,
      failureKind: 'network-error',
      elapsedMs: resilienceResult.elapsedMs,
      error: resilienceResult.error,
    });

    throw (
      resilienceResult.error ||
      new Error(
        `Failed to connect to Dify upstream for '${context.appId}' via '${targetConfig.difyApiUrl}'`
      )
    );
  }
}

async function sendUpstreamResponse(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  context: DifyProxyRequestContext;
  targetConfig: DifyProxyTargetConfig;
  slugPath: string;
  target: URL;
  targetUrl: string;
  upstream: Response;
  upstreamRequestStartedAt: number;
  resilienceElapsedMs: number;
}): Promise<void> {
  const {
    request,
    reply,
    context,
    target,
    upstream,
    upstreamRequestStartedAt,
    resilienceElapsedMs,
    slugPath,
  } = input;
  const agentSource = inferAgentSource(slugPath);
  const responseHeaderElapsedMs = Date.now() - upstreamRequestStartedAt;

  request.log.info(
    {
      appId: context.appId,
      route: context.routePath,
      slugPath,
      method: request.method,
      agentSource,
      targetHost: target.host,
      targetOrigin: target.origin,
      targetPath: target.pathname,
      upstreamStatus: upstream.status,
      upstreamContentType: upstream.headers.get('content-type') || '',
      responseHeaderElapsedMs,
      resilienceElapsedMs,
    },
    '[FastifyDifyProxy] upstream response headers received'
  );

  if (upstream.status === 204) {
    copyHeaders(reply, upstream.headers, key => {
      return !['content-length', 'content-type', 'transfer-encoding'].includes(
        key
      );
    });
    reply.status(204).send();
    return;
  }

  const responseContentType = (
    upstream.headers.get('content-type') || ''
  ).toLowerCase();

  if (upstream.body && responseContentType.includes('text/event-stream')) {
    await sendUpstreamStream(request, reply, upstream, {
      appId: context.appId,
      routePath: context.routePath,
      slugPath,
      streamKind: 'sse',
      requestStartedAt: upstreamRequestStartedAt,
      responseHeaderElapsedMs,
      targetHost: target.host,
      targetOrigin: target.origin,
      allow: key => {
        return (
          key === 'content-type' ||
          key === 'cache-control' ||
          key === 'connection'
        );
      },
      defaultHeaders: {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
    return;
  }

  if (upstream.body && isMediaContentType(responseContentType)) {
    await sendUpstreamStream(request, reply, upstream, {
      appId: context.appId,
      routePath: context.routePath,
      slugPath,
      streamKind: 'media',
      requestStartedAt: upstreamRequestStartedAt,
      responseHeaderElapsedMs,
      targetHost: target.host,
      targetOrigin: target.origin,
      allow: key => {
        return (
          key.startsWith('content-') ||
          key === 'accept-ranges' ||
          key === 'vary'
        );
      },
    });
    return;
  }

  const responseData = await upstream.text();

  try {
    const jsonData = JSON.parse(responseData);
    if (!upstream.ok) {
      logDifyProxyFailure(request, {
        appId: context.appId,
        routePath: context.routePath,
        slugPath,
        agentSource,
        failureKind: 'upstream-json-error',
        upstreamStatus: upstream.status,
        upstreamContentType: responseContentType,
        upstreamErrorCode:
          typeof jsonData?.code === 'string' ? jsonData.code : null,
        responseBody: responseData,
      });
    }
    const normalizedPayload = await withAgentErrorEnvelope(jsonData, {
      source: agentSource,
      status: upstream.status,
      locale: context.requestLocale,
      requestId: request.id,
      route: context.routePath,
      method: request.method,
      actorUserId: context.actor.userId,
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

    logDifyProxyFailure(request, {
      appId: context.appId,
      routePath: context.routePath,
      slugPath,
      agentSource,
      failureKind: 'upstream-text-error',
      upstreamStatus: upstream.status,
      upstreamContentType: responseContentType,
      responseBody: responseData,
    });

    const normalizedPayload = await withAgentErrorEnvelope(responseData, {
      source: agentSource,
      status: upstream.status,
      locale: context.requestLocale,
      requestId: request.id,
      route: context.routePath,
      method: request.method,
      actorUserId: context.actor.userId,
    });
    reply
      .type('application/json')
      .status(upstream.status)
      .send(normalizedPayload);
  }
}

export async function dispatchDifyUpstreamRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  context: DifyProxyRequestContext,
  targetConfig: DifyProxyTargetConfig
): Promise<void> {
  const slugPath = adjustApiPathByAppType(context.slug, targetConfig.appType);
  const agentSource = inferAgentSource(slugPath);
  const rawQuery = extractRawQuery(request.raw.url);
  const targetUrl = `${targetConfig.difyApiUrl.replace(/\/+$/, '')}/${slugPath}${rawQuery}`;
  const target = new URL(targetUrl);
  const upstreamRequestStartedAt = Date.now();
  const proxyTimeoutMs = resolveDifyProxyTimeoutMs();
  const circuitKey = `${context.appId}:${targetConfig.difyApiUrl}`;

  request.log.info(
    {
      appId: context.appId,
      route: context.routePath,
      slugPath,
      method: request.method,
      agentSource,
      targetHost: target.host,
      targetOrigin: target.origin,
      targetPath: target.pathname,
      queryPresent: rawQuery.length > 0,
      proxyTimeoutMs,
      circuit: getDifyProxyCircuitSnapshot(circuitKey),
    },
    '[FastifyDifyProxy] dispatch upstream request'
  );

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
  upstreamHeaders.set('Authorization', `Bearer ${targetConfig.difyApiKey}`);

  const actualMethod = targetConfig.tempConfigUsed ? 'GET' : request.method;
  const finalBody =
    actualMethod === 'GET' || actualMethod === 'HEAD'
      ? null
      : normalizeRequestBody(targetConfig.rawBody);

  if (
    finalBody &&
    typeof finalBody === 'string' &&
    !upstreamHeaders.has('Content-Type')
  ) {
    upstreamHeaders.set('Content-Type', 'application/json');
  }

  try {
    const resilienceResult = await fetchWithDifyProxyResilience({
      circuitKey,
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
      await handleResilienceFailure({
        request,
        reply,
        context,
        targetConfig,
        slugPath,
        agentSource,
        routePath: context.routePath,
        resilienceResult,
      });
      if (reply.sent || reply.raw.headersSent) {
        return;
      }
    }

    if (!resilienceResult.ok) {
      return;
    }

    await sendUpstreamResponse({
      request,
      reply,
      context,
      targetConfig,
      slugPath,
      target,
      targetUrl,
      upstream: resilienceResult.response,
      upstreamRequestStartedAt,
      resilienceElapsedMs: resilienceResult.elapsedMs,
    });
  } catch (error) {
    logDifyProxyFailure(request, {
      appId: context.appId,
      routePath: context.routePath,
      slugPath,
      agentSource,
      failureKind: 'request-failed',
      level: 'error',
      error,
    });

    if (isReplyCommitted(reply)) {
      request.log.warn(
        {
          appId: context.appId,
          route: context.routePath,
          slugPath,
          err: error,
        },
        '[FastifyDifyProxy] reply already committed, skip fallback error payload'
      );
      return;
    }

    const payload = await withAgentErrorEnvelope(
      {
        code: 'DIFY_PROXY_UPSTREAM_ERROR',
        error: `Failed to connect or process response from Dify service for app '${context.appId}'`,
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      {
        source: 'agent-generic',
        status: 502,
        locale: context.requestLocale,
        requestId: request.id,
        route: context.routePath,
        method: request.method,
        actorUserId: context.actor.userId,
      }
    );

    reply.status(502).send(payload);
  }
}
