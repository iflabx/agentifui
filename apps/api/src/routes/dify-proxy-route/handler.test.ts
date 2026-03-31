/** @jest-environment node */
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../../config';
import { handleDifyProxy } from './handler';
import { runInputModeration } from './input-moderation';
import { resolveProxyRequestContext } from './request-context';
import { resolveDifyTargetConfig } from './target-config';
import { dispatchDifyUpstreamRequest } from './upstream';

jest.mock('./request-context', () => ({
  resolveProxyRequestContext: jest.fn(),
}));

jest.mock('./target-config', () => ({
  resolveDifyTargetConfig: jest.fn(),
}));

jest.mock('./input-moderation', () => ({
  runInputModeration: jest.fn(),
}));

jest.mock('./upstream', () => ({
  dispatchDifyUpstreamRequest: jest.fn(),
}));

jest.mock('../../lib/error-events', () => ({
  recordApiErrorEvent: jest.fn().mockResolvedValue(undefined),
}));

function createConfig(
  overrides: Partial<ApiRuntimeConfig> = {}
): ApiRuntimeConfig {
  return {
    host: '127.0.0.1',
    port: 3010,
    logLevel: 'silent',
    nextUpstreamBaseUrl: 'http://127.0.0.1:3000',
    proxyPrefixes: ['/api/dify'],
    realtimeSourceMode: 'db-outbox',
    sessionCookieNames: ['session_token'],
    internalDataProxyTimeoutMs: 30000,
    difyTempConfigEnabled: false,
    difyTempConfigAllowedHosts: [],
    difyTempConfigAllowPrivate: false,
    inputModeration: {
      enabled: false,
      app: null,
    },
    ...overrides,
  };
}

function createRequest(method = 'POST'): FastifyRequest {
  return {
    id: 'req-1',
    method,
    headers: {},
    raw: {
      url: '/api/dify/app-1/chat-messages',
    },
  } as unknown as FastifyRequest;
}

function createReply(): FastifyReply {
  const reply = {
    sent: false,
    raw: {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
    },
    header: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(function send(payload: unknown) {
      reply.sent = true;
      return payload;
    }),
  };

  return reply as unknown as FastifyReply;
}

describe('handleDifyProxy input moderation integration', () => {
  const mockedResolveProxyRequestContext =
    resolveProxyRequestContext as jest.MockedFunction<
      typeof resolveProxyRequestContext
    >;
  const mockedResolveDifyTargetConfig =
    resolveDifyTargetConfig as jest.MockedFunction<
      typeof resolveDifyTargetConfig
    >;
  const mockedRunInputModeration = runInputModeration as jest.MockedFunction<
    typeof runInputModeration
  >;
  const mockedDispatchDifyUpstreamRequest =
    dispatchDifyUpstreamRequest as jest.MockedFunction<
      typeof dispatchDifyUpstreamRequest
    >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedResolveProxyRequestContext.mockResolvedValue({
      ok: true,
      context: {
        appId: 'app-1',
        slug: ['chat-messages'],
        routePath: '/api/dify/app-1/chat-messages',
        actor: {
          userId: 'user-1',
          role: 'user',
        },
      },
    });
    mockedResolveDifyTargetConfig.mockResolvedValue({
      ok: true,
      targetConfig: {
        difyApiKey: 'business-key',
        difyApiUrl: 'https://business.example.com/v1',
        tempConfigUsed: false,
        rawBody: { query: 'hello moderation' },
      },
    });
    mockedRunInputModeration.mockResolvedValue({
      outcome: 'skip',
    });
    mockedDispatchDifyUpstreamRequest.mockResolvedValue(undefined);
  });

  it('returns 400 and does not dispatch upstream when moderation blocks the request', async () => {
    const request = createRequest();
    const reply = createReply();
    mockedRunInputModeration.mockResolvedValue({
      outcome: 'block',
      categories: ['violence'],
    });

    await handleDifyProxy(request, reply, createConfig());

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledTimes(1);
    expect(mockedDispatchDifyUpstreamRequest).not.toHaveBeenCalled();
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        app_error: expect.objectContaining({
          code: 'CONTENT_MODERATION_BLOCKED',
          context: expect.objectContaining({
            moderation_categories: ['violence'],
          }),
        }),
      })
    );
  });

  it('returns 503 and does not dispatch upstream when moderation is unavailable', async () => {
    const request = createRequest();
    const reply = createReply();
    mockedRunInputModeration.mockResolvedValue({
      outcome: 'unavailable',
      reason: 'Moderation request timed out',
    });

    await handleDifyProxy(request, reply, createConfig());

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledTimes(1);
    expect(mockedDispatchDifyUpstreamRequest).not.toHaveBeenCalled();
  });

  it('dispatches upstream when moderation allows the request', async () => {
    const request = createRequest();
    const reply = createReply();
    mockedRunInputModeration.mockResolvedValue({
      outcome: 'allow',
      categories: [],
    });

    await handleDifyProxy(request, reply, createConfig());

    expect(mockedDispatchDifyUpstreamRequest).toHaveBeenCalledTimes(1);
    expect(reply.status).not.toHaveBeenCalledWith(400);
    expect(reply.status).not.toHaveBeenCalledWith(503);
  });
});
