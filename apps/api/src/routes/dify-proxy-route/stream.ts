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
const SSE_DEBUG_ENABLED = process.env.DIFY_PROXY_SSE_DEBUG === '1';
const SSE_DEBUG_SAMPLE_LIMIT = 20;

interface SseDebugState {
  enabled: boolean;
  sampleCount: number;
  buffer: string;
  eventCounts: Record<string, number>;
}

function createSseDebugState(): SseDebugState {
  return {
    enabled: SSE_DEBUG_ENABLED,
    sampleCount: 0,
    buffer: '',
    eventCounts: {},
  };
}

function recordSseDebugEvent(
  request: FastifyRequest,
  options: SendUpstreamStreamOptions,
  upstream: Response,
  state: SseDebugState,
  payload: string
) {
  if (!state.enabled || !payload.trim()) {
    return;
  }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const eventName =
      typeof parsed.event === 'string' ? parsed.event : 'unknown';

    state.eventCounts[eventName] = (state.eventCounts[eventName] || 0) + 1;

    if (state.sampleCount >= SSE_DEBUG_SAMPLE_LIMIT) {
      return;
    }

    state.sampleCount += 1;

    request.log.info(
      {
        appId: options.appId,
        route: options.routePath,
        slugPath: options.slugPath,
        streamKind: options.streamKind,
        upstreamStatus: upstream.status,
        upstreamContentType: upstream.headers.get('content-type') || '',
        sampleIndex: state.sampleCount,
        sseEvent: eventName,
        taskId: typeof parsed.task_id === 'string' ? parsed.task_id : null,
        conversationId:
          typeof parsed.conversation_id === 'string'
            ? parsed.conversation_id
            : null,
        messageId:
          typeof parsed.message_id === 'string' ? parsed.message_id : null,
        position: typeof parsed.position === 'number' ? parsed.position : null,
        answerLength:
          typeof parsed.answer === 'string' ? parsed.answer.length : null,
        thoughtLength:
          typeof parsed.thought === 'string' ? parsed.thought.length : null,
      },
      '[FastifyDifyProxy] SSE event sample'
    );
  } catch {
    request.log.info(
      {
        appId: options.appId,
        route: options.routePath,
        slugPath: options.slugPath,
        streamKind: options.streamKind,
        sampleIndex: state.sampleCount + 1,
        rawLength: payload.length,
      },
      '[FastifyDifyProxy] SSE sample parse skipped'
    );
  }
}

function inspectSseChunk(
  request: FastifyRequest,
  options: SendUpstreamStreamOptions,
  upstream: Response,
  state: SseDebugState,
  chunk: unknown
) {
  if (!state.enabled) {
    return;
  }

  const chunkText =
    typeof chunk === 'string'
      ? chunk
      : Buffer.isBuffer(chunk)
        ? chunk.toString('utf8')
        : String(chunk);

  state.buffer += chunkText;

  let boundaryIndex = state.buffer.indexOf('\n\n');
  while (boundaryIndex >= 0) {
    const rawEvent = state.buffer.slice(0, boundaryIndex);
    state.buffer = state.buffer.slice(boundaryIndex + 2);

    const dataLines = rawEvent
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart());

    if (dataLines.length > 0) {
      recordSseDebugEvent(
        request,
        options,
        upstream,
        state,
        dataLines.join('\n')
      );
    }

    boundaryIndex = state.buffer.indexOf('\n\n');
  }
}

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
  const sseDebugState = createSseDebugState();

  upstreamNodeStream.on('data', chunk => {
    byteCount += getChunkByteLength(chunk);
    chunkCount += 1;

    if (options.streamKind === 'sse') {
      inspectSseChunk(request, options, upstream, sseDebugState, chunk);
    }

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
        sseEventCounts:
          options.streamKind === 'sse' && sseDebugState.enabled
            ? sseDebugState.eventCounts
            : undefined,
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
        sseEventCounts:
          options.streamKind === 'sse' && sseDebugState.enabled
            ? sseDebugState.eventCounts
            : undefined,
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
        sseEventCounts:
          options.streamKind === 'sse' && sseDebugState.enabled
            ? sseDebugState.eventCounts
            : undefined,
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
