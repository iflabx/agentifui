/** @jest-environment node */
import Fastify from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { REQUEST_ID_HEADER } from '../lib/app-error';
import { recordFrontendErrorEvent } from '../lib/frontend-error-events';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { internalErrorEventsClientRoutes } from './internal-error-events-client';

jest.mock('../lib/frontend-error-events', () => ({
  recordFrontendErrorEvent: jest.fn(),
}));

jest.mock('../lib/session-identity', () => ({
  resolveIdentityFromSession: jest.fn(),
}));

function createConfig(
  overrides: Partial<ApiRuntimeConfig> = {}
): ApiRuntimeConfig {
  return {
    host: '127.0.0.1',
    port: 3010,
    logLevel: 'silent',
    nextUpstreamBaseUrl: 'http://127.0.0.1:3000',
    proxyPrefixes: ['/api/internal/error-events/client'],
    realtimeSourceMode: 'db-outbox',
    sessionCookieNames: ['session_token'],
    internalDataProxyTimeoutMs: 30000,
    difyTempConfigEnabled: false,
    difyTempConfigAllowedHosts: [],
    difyTempConfigAllowPrivate: false,
    ...overrides,
  };
}

async function createApp(configOverrides: Partial<ApiRuntimeConfig> = {}) {
  const app = Fastify({ logger: false });
  await app.register(internalErrorEventsClientRoutes, {
    config: createConfig(configOverrides),
  });
  return app;
}

describe('internal error events client route', () => {
  const mockedRecordFrontendErrorEvent =
    recordFrontendErrorEvent as jest.MockedFunction<
      typeof recordFrontendErrorEvent
    >;
  const mockedResolveIdentityFromSession =
    resolveIdentityFromSession as jest.MockedFunction<
      typeof resolveIdentityFromSession
    >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedResolveIdentityFromSession.mockResolvedValue({
      kind: 'unauthorized',
    });
    mockedRecordFrontendErrorEvent.mockResolvedValue();
  });

  it('accepts anonymous client reports and preserves payload request id', async () => {
    const app = await createApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/error-events/client',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          code: 'CLIENT_RUNTIME_ERROR',
          userMessage: 'Unexpected client error',
          requestId: 'req-from-payload',
          context: {
            pathname: '/chat',
          },
        },
      });

      expect(response.statusCode).toBe(202);
      expect(response.headers[REQUEST_ID_HEADER]).toBe('req-from-payload');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        success: true,
        request_id: 'req-from-payload',
      });
      expect(mockedRecordFrontendErrorEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CLIENT_RUNTIME_ERROR',
          userMessage: 'Unexpected client error',
          requestId: 'req-from-payload',
          route: '/chat',
          actorUserId: undefined,
          context: expect.objectContaining({
            pathname: '/chat',
            report_origin: 'browser',
          }),
        })
      );
    } finally {
      await app.close();
    }
  });

  it('includes actor user id when session identity resolves', async () => {
    mockedResolveIdentityFromSession.mockResolvedValueOnce({
      kind: 'ok',
      identity: {
        userId: '00000000-0000-4000-8000-000000000123',
        role: 'user',
      },
    });

    const app = await createApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/error-events/client',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          code: 'CLIENT_RUNTIME_ERROR',
          userMessage: 'Unexpected client error',
        },
      });

      expect(response.statusCode).toBe(202);
      expect(mockedRecordFrontendErrorEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: '00000000-0000-4000-8000-000000000123',
        })
      );
    } finally {
      await app.close();
    }
  });

  it('treats session resolver errors as best-effort only', async () => {
    mockedResolveIdentityFromSession.mockResolvedValueOnce({
      kind: 'error',
      reason: 'db unavailable',
    });

    const app = await createApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/error-events/client',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          code: 'CLIENT_RUNTIME_ERROR',
          userMessage: 'Unexpected client error',
        },
      });

      expect(response.statusCode).toBe(202);
      expect(mockedRecordFrontendErrorEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: undefined,
        })
      );
    } finally {
      await app.close();
    }
  });

  it('returns 400 for empty payload and preserves header request id', async () => {
    const app = await createApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/error-events/client',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-from-header',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.headers[REQUEST_ID_HEADER]).toBe('req-from-header');
      expect(response.json()).toMatchObject({
        success: false,
        request_id: 'req-from-header',
        app_error: {
          code: 'CLIENT_ERROR_REPORT_INVALID_PAYLOAD',
        },
      });
      expect(mockedRecordFrontendErrorEvent).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns 500 with fallback request id when persistence fails', async () => {
    mockedRecordFrontendErrorEvent.mockRejectedValueOnce(
      new Error('write failed')
    );

    const app = await createApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/error-events/client',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-from-header',
        },
        payload: {
          code: 'CLIENT_RUNTIME_ERROR',
          userMessage: 'Unexpected client error',
          requestId: 'req-from-payload',
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.headers[REQUEST_ID_HEADER]).toBe('req-from-header');
      expect(response.json()).toMatchObject({
        success: false,
        request_id: 'req-from-header',
        app_error: {
          code: 'CLIENT_ERROR_REPORT_FAILED',
        },
      });
    } finally {
      await app.close();
    }
  });
});
