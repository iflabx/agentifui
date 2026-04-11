/** @jest-environment node */
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  fetchWithDifyProxyResilience,
  getDifyProxyCircuitSnapshot,
} from '../../lib/dify-proxy-resilience';
import {
  injectTrustedUserContext,
  loadTrustedUserProfile,
  shouldInjectTrustedUserContext,
} from './trusted-user-context';
import type { DifyProxyRequestContext, DifyProxyTargetConfig } from './types';
import { dispatchDifyUpstreamRequest } from './upstream';

jest.mock('../../lib/dify-proxy-resilience', () => ({
  fetchWithDifyProxyResilience: jest.fn(),
  getDifyProxyCircuitSnapshot: jest.fn(),
}));

jest.mock('./trusted-user-context', () => ({
  injectTrustedUserContext: jest.fn(),
  loadTrustedUserProfile: jest.fn(),
  shouldInjectTrustedUserContext: jest.fn(),
}));

jest.mock('../../lib/error-events', () => ({
  recordApiErrorEvent: jest.fn().mockResolvedValue(undefined),
}));

function createRequest(
  overrides: Record<string, unknown> = {}
): FastifyRequest {
  return {
    id: 'req-1',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    raw: {
      url: '/api/dify/app-1/chat-messages',
    },
    log: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    ...overrides,
  } as unknown as FastifyRequest;
}

function createReply(): FastifyReply {
  const reply = {
    sent: false,
    raw: {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      setHeader: jest.fn(),
    },
    header: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(function send(payload: unknown) {
      reply.sent = true;
      return payload;
    }),
  };

  return reply as unknown as FastifyReply;
}

function createContext(
  overrides: Partial<DifyProxyRequestContext> = {}
): DifyProxyRequestContext {
  return {
    appId: 'app-1',
    slug: ['chat-messages'],
    routePath: '/api/dify/app-1/chat-messages',
    actor: {
      userId: '00000000-0000-4000-8000-000000000123',
      role: 'user',
    },
    ...overrides,
  };
}

function createTargetConfig(
  overrides: Partial<DifyProxyTargetConfig> = {}
): DifyProxyTargetConfig {
  return {
    difyApiKey: 'app-key',
    difyApiUrl: 'https://dify.example.com/v1',
    tempConfigUsed: false,
    rawBody: {
      query: 'hello',
      inputs: {
        foo: 'bar',
      },
      user: 'frontend-user',
    },
    ...overrides,
  };
}

describe('dispatchDifyUpstreamRequest trusted user context integration', () => {
  const originalFetch = global.fetch;
  const mockedFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
  const mockedFetchWithDifyProxyResilience =
    fetchWithDifyProxyResilience as jest.MockedFunction<
      typeof fetchWithDifyProxyResilience
    >;
  const mockedGetDifyProxyCircuitSnapshot =
    getDifyProxyCircuitSnapshot as jest.MockedFunction<
      typeof getDifyProxyCircuitSnapshot
    >;
  const mockedLoadTrustedUserProfile =
    loadTrustedUserProfile as jest.MockedFunction<
      typeof loadTrustedUserProfile
    >;
  const mockedInjectTrustedUserContext =
    injectTrustedUserContext as jest.MockedFunction<
      typeof injectTrustedUserContext
    >;
  const mockedShouldInjectTrustedUserContext =
    shouldInjectTrustedUserContext as jest.MockedFunction<
      typeof shouldInjectTrustedUserContext
    >;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockedFetch;
    mockedGetDifyProxyCircuitSnapshot.mockReturnValue({
      status: 'closed',
      openedAt: null,
      halfOpenInFlight: 0,
      failureCount: 0,
    });
    mockedShouldInjectTrustedUserContext.mockReturnValue(true);
    mockedLoadTrustedUserProfile.mockResolvedValue({
      fullName: '张三',
      username: 'zhangsan',
      email: 'user@example.com',
      employeeNumber: '20260001',
      department: '图书馆',
      jobTitle: '学生',
    });
    mockedInjectTrustedUserContext.mockReturnValue({
      query: 'hello',
      inputs: {
        foo: 'bar',
        agentifui_user_id: '00000000-0000-4000-8000-000000000123',
      },
      user: '00000000-0000-4000-8000-000000000123',
    });
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })
    );
    mockedFetchWithDifyProxyResilience.mockImplementation(async input => ({
      ok: true,
      response: await input.execute(new AbortController().signal),
      elapsedMs: 12,
      circuitStatus: 'closed',
    }));
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('injects trusted user context for chat requests before dispatch', async () => {
    await dispatchDifyUpstreamRequest(
      createRequest(),
      createReply(),
      createContext(),
      createTargetConfig()
    );

    expect(mockedShouldInjectTrustedUserContext).toHaveBeenCalledWith(
      'POST',
      'chat-messages'
    );
    expect(mockedLoadTrustedUserProfile).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000123'
    );
    expect(mockedInjectTrustedUserContext).toHaveBeenCalledWith(
      createTargetConfig().rawBody,
      createContext().actor,
      expect.objectContaining({
        fullName: '张三',
      })
    );
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://dify.example.com/v1/chat-messages',
      expect.any(Object)
    );
    const fetchInit = mockedFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchInit?.method).toBe('POST');
    expect(JSON.parse(String(fetchInit?.body))).toEqual({
      query: 'hello',
      inputs: {
        foo: 'bar',
        agentifui_user_id: '00000000-0000-4000-8000-000000000123',
      },
      user: '00000000-0000-4000-8000-000000000123',
    });
  });

  it('adjusts text-generation routes to completion-messages before injection', async () => {
    await dispatchDifyUpstreamRequest(
      createRequest(),
      createReply(),
      createContext(),
      createTargetConfig({
        appType: 'text-generation',
      })
    );

    expect(mockedShouldInjectTrustedUserContext).toHaveBeenCalledWith(
      'POST',
      'completion-messages'
    );
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://dify.example.com/v1/completion-messages',
      expect.any(Object)
    );
  });

  it('adjusts workflow routes to workflows/run before injection', async () => {
    await dispatchDifyUpstreamRequest(
      createRequest({
        raw: {
          url: '/api/dify/app-1/run',
        },
      }),
      createReply(),
      createContext({
        slug: ['run'],
        routePath: '/api/dify/app-1/run',
      }),
      createTargetConfig({
        appType: 'workflow',
      })
    );

    expect(mockedShouldInjectTrustedUserContext).toHaveBeenCalledWith(
      'POST',
      'workflows/run'
    );
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://dify.example.com/v1/workflows/run',
      expect.any(Object)
    );
  });

  it('falls back to minimal actor context when profile lookup fails', async () => {
    mockedLoadTrustedUserProfile.mockRejectedValueOnce(
      new Error('profile db unavailable')
    );

    const request = createRequest();

    await dispatchDifyUpstreamRequest(
      request,
      createReply(),
      createContext(),
      createTargetConfig()
    );

    expect(mockedInjectTrustedUserContext).toHaveBeenCalledWith(
      createTargetConfig().rawBody,
      createContext().actor,
      null
    );
    expect(request.log.warn).toHaveBeenCalled();
  });
});
