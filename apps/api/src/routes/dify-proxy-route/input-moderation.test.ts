/** @jest-environment node */
import type { FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../../config';
import {
  extractModerationText,
  runInputModeration,
  shouldModerateRequest,
} from './input-moderation';
import type { DifyProxyRequestContext, DifyProxyTargetConfig } from './types';

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
      enabled: true,
      app: {
        apiUrl: 'https://moderation.example.com/v1',
        apiKey: 'app-moderation',
      },
    },
    ...overrides,
  };
}

function createRequest(method = 'POST'): FastifyRequest {
  return {
    method,
    log: {
      warn: jest.fn(),
    },
  } as unknown as FastifyRequest;
}

function createContext(
  overrides: Partial<DifyProxyRequestContext> = {}
): DifyProxyRequestContext {
  return {
    appId: 'app-1',
    slug: ['chat-messages'],
    routePath: '/api/dify/app-1/chat-messages',
    actor: {
      userId: 'user-1',
      role: 'user',
    },
    ...overrides,
  };
}

function createTargetConfig(
  overrides: Partial<DifyProxyTargetConfig> = {}
): DifyProxyTargetConfig {
  return {
    difyApiKey: 'business-key',
    difyApiUrl: 'https://business.example.com/v1',
    tempConfigUsed: false,
    rawBody: {
      query: 'hello moderation',
    },
    ...overrides,
  };
}

describe('input moderation helpers', () => {
  const originalFetch = global.fetch;
  const mockedFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockedFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('matches only POST chat/completion endpoints', () => {
    expect(shouldModerateRequest('POST', ['chat-messages'])).toBe(true);
    expect(shouldModerateRequest('POST', ['completion-messages'])).toBe(true);
    expect(shouldModerateRequest('GET', ['chat-messages'])).toBe(false);
    expect(
      shouldModerateRequest('POST', ['chat-messages', 'task-1', 'stop'])
    ).toBe(false);
    expect(shouldModerateRequest('POST', ['files', 'upload'])).toBe(false);
  });

  it('extracts moderation text from query and inputs.query', () => {
    expect(extractModerationText({ query: 'hello' })).toBe('hello');
    expect(extractModerationText({ inputs: { query: 'nested hello' } })).toBe(
      'nested hello'
    );
    expect(extractModerationText({ inputs: { query: '   ' } })).toBeNull();
  });

  it('skips moderation when the feature is disabled', async () => {
    const result = await runInputModeration({
      request: createRequest(),
      config: createConfig({
        inputModeration: { enabled: false, app: null },
      }),
      context: createContext(),
      targetConfig: createTargetConfig(),
    });

    expect(result).toEqual({ outcome: 'skip' });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('allows safe requests from direct JSON moderation responses', async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ is_safe: true, categories: [] }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })
    );

    const result = await runInputModeration({
      request: createRequest(),
      config: createConfig(),
      context: createContext(),
      targetConfig: createTargetConfig(),
    });

    expect(result).toEqual({
      outcome: 'allow',
      categories: [],
    });
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://moderation.example.com/v1/chat-messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: 'Bearer app-moderation',
        }),
      })
    );
    expect(JSON.parse(String(mockedFetch.mock.calls[0]?.[1]?.body))).toEqual({
      inputs: {},
      query: 'hello moderation',
      response_mode: 'blocking',
      user: 'user-1',
      conversation_id: '',
    });
  });

  it('blocks unsafe requests from legacy moderation answer text', async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          answer: 'Safety: Unsafe Categories: violence, hate_speech',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      )
    );

    const result = await runInputModeration({
      request: createRequest(),
      config: createConfig(),
      context: createContext(),
      targetConfig: createTargetConfig(),
    });

    expect(result).toEqual({
      outcome: 'block',
      categories: ['violence', 'hate_speech'],
    });
  });

  it('blocks unsafe requests from a legacy keyed moderation JSON object', async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          'Safety: Unsafe': 'Categories: Violent',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      )
    );

    const result = await runInputModeration({
      request: createRequest(),
      config: createConfig(),
      context: createContext(),
      targetConfig: createTargetConfig(),
    });

    expect(result).toEqual({
      outcome: 'block',
      categories: ['Violent'],
    });
  });

  it('blocks unsafe requests when answer wraps a legacy moderation JSON string', async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          answer: JSON.stringify({
            'Safety: Unsafe': 'Categories: Violent',
          }),
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      )
    );

    const result = await runInputModeration({
      request: createRequest(),
      config: createConfig(),
      context: createContext(),
      targetConfig: createTargetConfig(),
    });

    expect(result).toEqual({
      outcome: 'block',
      categories: ['Violent'],
    });
  });

  it('blocks unsafe requests from status and reason payloads', async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: ' Unsafe',
          reason: ' Violent',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      )
    );

    const result = await runInputModeration({
      request: createRequest(),
      config: createConfig(),
      context: createContext(),
      targetConfig: createTargetConfig(),
    });

    expect(result).toEqual({
      outcome: 'block',
      categories: ['Violent'],
    });
  });

  it('sanitizes dirty moderation category values', async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          answer: JSON.stringify({
            'Safety: Unsafe': {
              Categories: [' "Violent"}'],
            },
          }),
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      )
    );

    const result = await runInputModeration({
      request: createRequest(),
      config: createConfig(),
      context: createContext(),
      targetConfig: createTargetConfig(),
    });

    expect(result).toEqual({
      outcome: 'block',
      categories: ['Violent'],
    });
  });

  it('returns unavailable when moderation upstream fails', async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response('upstream failed', {
        status: 503,
        headers: {
          'content-type': 'text/plain',
        },
      })
    );

    const result = await runInputModeration({
      request: createRequest(),
      config: createConfig(),
      context: createContext(),
      targetConfig: createTargetConfig(),
    });

    expect(result).toEqual({
      outcome: 'unavailable',
      reason: 'Moderation upstream returned HTTP 503',
    });
  });
});
