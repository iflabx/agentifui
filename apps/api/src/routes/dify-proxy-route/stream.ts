import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable, pipeline } from 'node:stream';
import { promisify } from 'node:util';

import {
  copyRawHeaders,
  getChunkByteLength,
  isReplyCommitted,
} from './helpers';
import type { SendUpstreamStreamOptions } from './types';

const pipelineAsync = promisify(pipeline);

export async function sendUpstreamStream(
  request: FastifyRequest,
  reply: FastifyReply,
  upstream: Response,
  options: SendUpstreamStreamOptions
): Promise<void> {
  const startedAt = Date.now();
  const upstreamContentType = upstream.headers.get('content-type') || '';
  const upstreamNodeStream = Readable.fromWeb(upstream.body as never);
  let byteCount = 0;
  let chunkCount = 0;
  let closeLogged = false;
  let firstChunkLogged = false;

  upstreamNodeStream.on('data', chunk => {
    byteCount += getChunkByteLength(chunk);
    chunkCount += 1;

    if (!firstChunkLogged) {
      firstChunkLogged = true;
      request.log.info(
        {
          appId: options.appId,
          route: options.routePath,
          slugPath: options.slugPath,
          streamKind: options.streamKind,
          upstreamStatus: upstream.status,
          upstreamContentType,
          targetHost: options.targetHost,
          targetOrigin: options.targetOrigin,
          responseHeaderElapsedMs: options.responseHeaderElapsedMs,
          firstChunkElapsedMs: Date.now() - options.requestStartedAt,
          firstChunkSincePipeMs: Date.now() - startedAt,
          byteCount,
          chunkCount,
        },
        '[FastifyDifyProxy] upstream first chunk received'
      );
    }
  });

  const handleResponseClose = () => {
    if (closeLogged || reply.raw.writableEnded) {
      return;
    }
    closeLogged = true;
    request.log.warn(
      {
        appId: options.appId,
        route: options.routePath,
        slugPath: options.slugPath,
        streamKind: options.streamKind,
        upstreamStatus: upstream.status,
        upstreamContentType,
        targetHost: options.targetHost,
        targetOrigin: options.targetOrigin,
        responseHeaderElapsedMs: options.responseHeaderElapsedMs,
        byteCount,
        chunkCount,
        durationMs: Date.now() - startedAt,
        totalElapsedMs: Date.now() - options.requestStartedAt,
      },
      '[FastifyDifyProxy] downstream stream closed early'
    );
  };

  reply.hijack();
  reply.raw.statusCode = upstream.status;
  copyRawHeaders(reply, upstream.headers, options.allow);

  for (const [key, value] of Object.entries(options.defaultHeaders || {})) {
    if (!reply.raw.hasHeader(key)) {
      reply.raw.setHeader(key, value);
    }
  }

  if (typeof reply.raw.flushHeaders === 'function') {
    reply.raw.flushHeaders();
  }

  request.log.info(
    {
      appId: options.appId,
      route: options.routePath,
      slugPath: options.slugPath,
      streamKind: options.streamKind,
      upstreamStatus: upstream.status,
      upstreamContentType,
      targetHost: options.targetHost,
      targetOrigin: options.targetOrigin,
      responseHeaderElapsedMs: options.responseHeaderElapsedMs,
    },
    '[FastifyDifyProxy] upstream stream started'
  );

  reply.raw.once('close', handleResponseClose);

  try {
    await pipelineAsync(upstreamNodeStream, reply.raw);
    request.log.info(
      {
        appId: options.appId,
        route: options.routePath,
        slugPath: options.slugPath,
        streamKind: options.streamKind,
        upstreamStatus: upstream.status,
        upstreamContentType,
        targetHost: options.targetHost,
        targetOrigin: options.targetOrigin,
        responseHeaderElapsedMs: options.responseHeaderElapsedMs,
        byteCount,
        chunkCount,
        durationMs: Date.now() - startedAt,
        totalElapsedMs: Date.now() - options.requestStartedAt,
      },
      '[FastifyDifyProxy] upstream stream completed'
    );
  } catch (error) {
    request.log.warn(
      {
        err: error,
        appId: options.appId,
        route: options.routePath,
        slugPath: options.slugPath,
        streamKind: options.streamKind,
        upstreamStatus: upstream.status,
        upstreamContentType,
        targetHost: options.targetHost,
        targetOrigin: options.targetOrigin,
        responseHeaderElapsedMs: options.responseHeaderElapsedMs,
        byteCount,
        chunkCount,
        durationMs: Date.now() - startedAt,
        totalElapsedMs: Date.now() - options.requestStartedAt,
      },
      '[FastifyDifyProxy] upstream stream failed'
    );

    if (isReplyCommitted(reply)) {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.destroy(
          error instanceof Error ? error : new Error(String(error))
        );
      }
      return;
    }

    throw error;
  } finally {
    reply.raw.removeListener('close', handleResponseClose);
  }
}
