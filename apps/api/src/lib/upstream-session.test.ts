/** @jest-environment node */
import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from './pg-context';
import {
  resolveIdentityFromUpstream,
  resolveProfileStatusFromUpstream,
} from './upstream-session';

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
    internalDataProxyTimeoutMs: 30000,
    internalDataLegacyFallbackEnabled: false,
    upstreamProfileStatusFallbackEnabled: false,
    ...overrides,
  };
}

function createRequest(headers: Record<string, string> = {}) {
  return {
    headers,
  } as never;
}

describe('upstream-session resolver', () => {
  const mockedQueryRowsWithPgSystemContext =
    queryRowsWithPgSystemContext as jest.MockedFunction<
      typeof queryRowsWithPgSystemContext
    >;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
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

    const result = await resolveProfileStatusFromUpstream(
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
    expect(global.fetch).not.toHaveBeenCalled();
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

    const result = await resolveProfileStatusFromUpstream(
      createRequest({ cookie: 'session_token=token-123' }),
      createConfig()
    );

    expect(result).toEqual({ kind: 'unauthorized' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to upstream profile-status when local resolve errors and fallback is enabled', async () => {
    mockedQueryRowsWithPgSystemContext.mockRejectedValueOnce(
      new Error('db unavailable')
    );
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          userId: '00000000-0000-4000-8000-000000000012',
          authUserId: '00000000-0000-4000-8000-000000000012',
          role: 'user',
          status: 'active',
        }),
        { status: 200 }
      )
    );

    const result = await resolveProfileStatusFromUpstream(
      createRequest({ cookie: 'session_token=token-456' }),
      createConfig({ upstreamProfileStatusFallbackEnabled: true })
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') {
      throw new Error('Expected resolved identity');
    }
    expect(result.identity.userId).toBe('00000000-0000-4000-8000-000000000012');
    expect(global.fetch).toHaveBeenCalledTimes(1);
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

    const result = await resolveIdentityFromUpstream(
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
