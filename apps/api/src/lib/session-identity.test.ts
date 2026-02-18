/** @jest-environment node */
import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from './pg-context';
import {
  getSessionResolverMetricsSnapshot,
  resetSessionResolverMetrics,
  resolveIdentityFromSession,
  resolveProfileStatusFromSession,
} from './session-identity';

jest.mock('./pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
}));

function createConfig(
  overrides: Partial<ApiRuntimeConfig> = {}
): ApiRuntimeConfig {
  return {
    host: '0.0.0.0',
    port: 3010,
    logLevel: 'info',
    nextUpstreamBaseUrl: 'http://127.0.0.1:3000',
    proxyPrefixes: ['/api/internal'],
    proxyFallbackEnabled: false,
    realtimeSourceMode: 'db-outbox',
    sessionCookieNames: ['session_token', 'better-auth.session_token'],
    internalDataProxyTimeoutMs: 30000,
    ...overrides,
  };
}

function createRequest(headers: Record<string, string> = {}) {
  return {
    headers,
  } as never;
}

describe('session-identity resolver', () => {
  const mockedQueryRowsWithPgSystemContext =
    queryRowsWithPgSystemContext as jest.MockedFunction<
      typeof queryRowsWithPgSystemContext
    >;

  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionResolverMetrics();
  });

  it('resolves active identity locally from session cookie', async () => {
    mockedQueryRowsWithPgSystemContext.mockResolvedValueOnce([
      {
        auth_user_id: '00000000-0000-4000-8000-000000000010',
        user_id: '00000000-0000-4000-8000-000000000010',
        role: 'admin',
        status: 'active',
      } as never,
    ]);

    const result = await resolveProfileStatusFromSession(
      createRequest({
        cookie: 'session_token=token-123.sig%2Babc; theme=dark',
      }),
      createConfig()
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') {
      throw new Error('Expected resolved identity');
    }
    expect(result.identity).toEqual({
      userId: '00000000-0000-4000-8000-000000000010',
      authUserId: '00000000-0000-4000-8000-000000000010',
      role: 'admin',
      status: 'active',
    });
    expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(1);
    const queryParams = mockedQueryRowsWithPgSystemContext.mock
      .calls[0]?.[1] as unknown[] | undefined;
    expect(queryParams?.[0]).toContain('token-123');
    expect(queryParams?.[0]).not.toContain('dark');
    expect(getSessionResolverMetricsSnapshot()).toMatchObject({
      local_ok: 1,
    });
  });

  it('ignores non-session cookies when extracting token candidates', async () => {
    const result = await resolveProfileStatusFromSession(
      createRequest({
        cookie: 'theme=dark; locale=zh-CN',
      }),
      createConfig()
    );

    expect(result).toEqual({ kind: 'unauthorized' });
    expect(mockedQueryRowsWithPgSystemContext).not.toHaveBeenCalled();
    expect(getSessionResolverMetricsSnapshot()).toMatchObject({
      local_unauthorized: 1,
    });
  });

  it('returns unauthorized when local profile status is not active', async () => {
    mockedQueryRowsWithPgSystemContext.mockResolvedValueOnce([
      {
        auth_user_id: '00000000-0000-4000-8000-000000000011',
        user_id: '00000000-0000-4000-8000-000000000011',
        role: 'user',
        status: 'suspended',
      } as never,
    ]);

    const result = await resolveProfileStatusFromSession(
      createRequest({ cookie: 'session_token=token-123' }),
      createConfig()
    );

    expect(result).toEqual({ kind: 'unauthorized' });
    expect(getSessionResolverMetricsSnapshot()).toMatchObject({
      local_unauthorized: 1,
    });
  });

  it('returns local error when local resolver fails', async () => {
    mockedQueryRowsWithPgSystemContext.mockRejectedValueOnce(
      new Error('db unavailable')
    );

    const result = await resolveProfileStatusFromSession(
      createRequest({ cookie: 'session_token=token-456' }),
      createConfig()
    );

    expect(result.kind).toBe('error');
    if (result.kind !== 'error') {
      throw new Error('Expected local resolver error');
    }
    expect(result.reason).toContain('db unavailable');
    expect(getSessionResolverMetricsSnapshot()).toMatchObject({
      local_error: 1,
    });
  });

  it('maps profile status identity to actor identity', async () => {
    mockedQueryRowsWithPgSystemContext.mockResolvedValueOnce([
      {
        auth_user_id: '00000000-0000-4000-8000-000000000013',
        user_id: '00000000-0000-4000-8000-000000000013',
        role: 'admin',
        status: 'active',
      } as never,
    ]);

    const result = await resolveIdentityFromSession(
      createRequest({ cookie: 'session_token=token-789' }),
      createConfig()
    );

    expect(result).toEqual({
      kind: 'ok',
      identity: {
        userId: '00000000-0000-4000-8000-000000000013',
        role: 'admin',
      },
    });
  });
});
