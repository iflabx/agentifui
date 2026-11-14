/** @jest-environment node */
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../../config';
import { AgentPolicyError } from '../../lib/agent-backends';
import {
  admitSubmission,
  registerSubmission,
  rejectSubmission,
} from '../../lib/agent-submissions';
import { handleDifyProxy } from './handler';
import { runInputModeration } from './input-moderation';
import { resolveProxyRequestContext } from './request-context';
import { resolveDifyTargetConfig } from './target-config';
import { dispatchDifyUpstreamRequest } from './upstream';

jest.mock('./request-context', () => ({
  resolveProxyRequestContext: jest.fn(),
}));

jest.mock('../../lib/agent-submissions', () => ({
  ...jest.requireActual('../../lib/agent-submissions'),
  registerSubmission: jest.fn(),
  admitSubmission: jest.fn().mockResolvedValue(undefined),
  rejectSubmission: jest.fn().mockResolvedValue(undefined),
  submissionStorage: jest.fn(async operation => operation({})),
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
    corsAllowedOrigins: [],
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
    headers: {
      'x-agentifui-submission-id': '30000000-0000-4000-8000-000000000001',
    },
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
    jest.mocked(registerSubmission).mockResolvedValue({
      task: { root_task_id: 'root-task' } as never,
      replayed: false,
    });
    jest.mocked(admitSubmission).mockResolvedValue(undefined);
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
        serviceInstanceId: '20000000-0000-4000-8000-000000000001',
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

  it('requires durable identity for generation even when bypassing the UI', async () => {
    const request = createRequest();
    delete request.headers['x-agentifui-submission-id'];
    const reply = createReply();
    await handleDifyProxy(request, reply, createConfig());
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(mockedDispatchDifyUpstreamRequest).not.toHaveBeenCalled();
    expect(mockedRunInputModeration).not.toHaveBeenCalled();
  });

  it('does not redispatch or re-moderate an unknown duplicate submission', async () => {
    jest.mocked(registerSubmission).mockResolvedValue({
      task: { root_task_id: 'root-task', state: 'unknown' } as never,
      replayed: true,
    });
    const reply = createReply();
    await handleDifyProxy(createRequest(), reply, createConfig());
    expect(reply.status).toHaveBeenCalledWith(409);
    expect(mockedRunInputModeration).not.toHaveBeenCalled();
    expect(admitSubmission).not.toHaveBeenCalled();
    expect(mockedDispatchDifyUpstreamRequest).not.toHaveBeenCalled();
  });

  it('rejects quota before touching the upstream and records the rejection', async () => {
    jest
      .mocked(admitSubmission)
      .mockRejectedValueOnce(new AgentPolicyError(429, 'AGENT_QUOTA_EXCEEDED'));
    const reply = createReply();
    await handleDifyProxy(createRequest(), reply, createConfig());
    expect(reply.status).toHaveBeenCalledWith(429);
    expect(rejectSubmission).toHaveBeenCalledWith(
      'root-task',
      'AGENT_QUOTA_EXCEEDED'
    );
    expect(mockedDispatchDifyUpstreamRequest).not.toHaveBeenCalled();
  });

  it('passes canonical workflow aliases through the same moderation and quota door', async () => {
    const context = await mockedResolveProxyRequestContext(
      createRequest(),
      createConfig()
    );
    if (!context.ok) throw new Error('test fixture');
    mockedResolveProxyRequestContext.mockResolvedValue({
      ok: true,
      context: { ...context.context, slug: ['run'] },
    });
    const target = await mockedResolveDifyTargetConfig(
      createRequest(),
      createConfig(),
      context.context
    );
    if (!target.ok) throw new Error('test fixture');
    mockedResolveDifyTargetConfig.mockResolvedValue({
      ok: true,
      targetConfig: {
        ...target.targetConfig,
        appType: 'workflow',
        rawBody: { inputs: { topic: 'synthetic' } },
      },
    });
    await handleDifyProxy(createRequest(), createReply(), createConfig());
    expect(mockedRunInputModeration).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ slug: ['workflows', 'run'] }),
      })
    );
    expect(admitSubmission).toHaveBeenCalledTimes(1);
    expect(mockedDispatchDifyUpstreamRequest).toHaveBeenCalledTimes(1);
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
