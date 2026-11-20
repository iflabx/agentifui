/** @jest-environment node */
import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from './pg-context';
import {
  getSessionResolverMetricsSnapshot,
  invalidateSessionIdentityTokens,
  resetSessionResolverMetrics,
  resolveIdentityFromSession,
  resolveProfileStatusFromSession,
} from './session-identity';

jest.mock('./pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
}));

const SESSION_RESOLVER_CACHE_KEY =
  '__agentifui_fastify_session_resolver_cache__';

function createConfig(
  overrides: Partial<ApiRuntimeConfig> = {}
): ApiRuntimeConfig {
  return {
    host: '0.0.0.0',
    port: 3010,
    logLevel: 'info',
    corsAllowedOrigins: [],
    nextUpstreamBaseUrl: 'http://127.0.0.1:3000',
    proxyPrefixes: ['/api/internal'],
    realtimeSourceMode: 'db-outbox',
    sessionCookieNames: ['session_token', 'better-auth.session_token'],
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
    delete (globalThis as Record<string, unknown>)[SESSION_RESOLVER_CACHE_KEY];
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
        authUserId: '00000000-0000-4000-8000-000000000013',
        role: 'admin',
      },
    });
  });

  it('preserves auth user id when profile id differs from auth id', async () => {
    mockedQueryRowsWithPgSystemContext.mockResolvedValueOnce([
      {
        auth_user_id: '00000000-0000-4000-8000-000000000021',
        user_id: '00000000-0000-4000-8000-000000000022',
        role: 'user',
        status: 'active',
      } as never,
    ]);

    const result = await resolveIdentityFromSession(
      createRequest({ cookie: 'session_token=token-790' }),
      createConfig()
    );

    expect(result).toEqual({
      kind: 'ok',
      identity: {
        userId: '00000000-0000-4000-8000-000000000022',
        authUserId: '00000000-0000-4000-8000-000000000021',
        role: 'user',
      },
    });
  });

  it('deduplicates concurrent local session lookups for the same token', async () => {
    let resolveQuery:
      ((value: Array<Record<string, unknown>>) => void) | undefined;

    mockedQueryRowsWithPgSystemContext.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveQuery = resolve;
        }) as ReturnType<typeof queryRowsWithPgSystemContext>
    );

    const request = createRequest({ cookie: 'session_token=shared-token' });
    const config = createConfig();

    const firstPromise = resolveProfileStatusFromSession(request, config);
    const secondPromise = resolveProfileStatusFromSession(request, config);
    const thirdPromise = resolveProfileStatusFromSession(request, config);

    expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(1);

    resolveQuery?.([
      {
        auth_user_id: '00000000-0000-4000-8000-000000000099',
        user_id: '00000000-0000-4000-8000-000000000099',
        role: 'user',
        status: 'active',
      },
    ]);

    const [first, second, third] = await Promise.all([
      firstPromise,
      secondPromise,
      thirdPromise,
    ]);

    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(first).toEqual({
      kind: 'ok',
      identity: {
        userId: '00000000-0000-4000-8000-000000000099',
        authUserId: '00000000-0000-4000-8000-000000000099',
        role: 'user',
        status: 'active',
      },
    });
  });

  it('bypasses the short identity cache for a new authorization check', async () => {
    mockedQueryRowsWithPgSystemContext
      .mockResolvedValueOnce([
        {
          auth_user_id: '00000000-0000-4000-8000-000000000100',
          user_id: '00000000-0000-4000-8000-000000000100',
          role: 'user',
          status: 'active',
        } as never,
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const request = createRequest({ cookie: 'session_token=revoked-token' });
    const config = createConfig();

    await expect(
      resolveProfileStatusFromSession(request, config)
    ).resolves.toMatchObject({ kind: 'ok' });
    await expect(
      resolveProfileStatusFromSession(request, config, { bypassCache: true })
    ).resolves.toEqual({ kind: 'unauthorized' });
    await expect(
      resolveProfileStatusFromSession(request, config)
    ).resolves.toEqual({ kind: 'unauthorized' });
    expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(3);
  });

  describe('cache invalidation races and expiry deadlines', () => {
    const startedAt = Date.parse('2026-11-19T12:00:00.000Z');
    let previousCacheTtl: string | undefined;

    function activeRows(expiresAt = startedAt + 60_000, role = 'user') {
      return [
        {
          auth_user_id: '00000000-0000-4000-8000-000000000099',
          user_id: '00000000-0000-4000-8000-000000000099',
          role,
          status: 'active',
          session_expires_at: new Date(expiresAt).toISOString(),
        },
      ];
    }

    function deferredQuery() {
      let resolveRows!: (rows: Array<Record<string, unknown>>) => void;
      const promise = new Promise<Array<Record<string, unknown>>>(resolve => {
        resolveRows = resolve;
      });
      return { promise, resolve: resolveRows };
    }

    beforeEach(() => {
      previousCacheTtl = process.env.FASTIFY_SESSION_IDENTITY_CACHE_TTL_MS;
      process.env.FASTIFY_SESSION_IDENTITY_CACHE_TTL_MS = '1000';
      mockedQueryRowsWithPgSystemContext.mockReset();
      jest.useFakeTimers();
      jest.setSystemTime(startedAt);
    });

    afterEach(() => {
      jest.useRealTimers();
      if (previousCacheTtl === undefined) {
        delete process.env.FASTIFY_SESSION_IDENTITY_CACHE_TTL_MS;
      } else {
        process.env.FASTIFY_SESSION_IDENTITY_CACHE_TTL_MS = previousCacheTtl;
      }
      mockedQueryRowsWithPgSystemContext.mockReset();
      delete (globalThis as Record<string, unknown>)[
        SESSION_RESOLVER_CACHE_KEY
      ];
    });

    it('does not refill the cache from an invalidated in-flight lookup', async () => {
      const oldQuery = deferredQuery();
      mockedQueryRowsWithPgSystemContext
        .mockImplementationOnce(() => oldQuery.promise)
        .mockResolvedValueOnce([]);
      const request = createRequest({ cookie: 'session_token=revoked-token' });
      const config = createConfig();

      const oldLookup = resolveProfileStatusFromSession(request, config);
      expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(1);
      invalidateSessionIdentityTokens(['revoked-token']);
      oldQuery.resolve(activeRows());

      await expect(oldLookup).resolves.toMatchObject({ kind: 'ok' });
      await expect(
        resolveProfileStatusFromSession(request, config)
      ).resolves.toEqual({ kind: 'unauthorized' });
      expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(2);
    });

    it('does not let an old completion remove or replace newer in-flight work', async () => {
      const oldQuery = deferredQuery();
      const newQuery = deferredQuery();
      mockedQueryRowsWithPgSystemContext
        .mockImplementationOnce(() => oldQuery.promise)
        .mockImplementationOnce(() => newQuery.promise);
      const request = createRequest({ cookie: 'session_token=racing-token' });
      const config = createConfig();

      const oldLookup = resolveProfileStatusFromSession(request, config);
      invalidateSessionIdentityTokens(['racing-token']);
      const newLookup = resolveProfileStatusFromSession(request, config);
      expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(2);

      oldQuery.resolve(activeRows(startedAt + 60_000, 'admin'));
      await expect(oldLookup).resolves.toMatchObject({ kind: 'ok' });
      const joinedLookup = resolveProfileStatusFromSession(request, config);
      expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(2);

      newQuery.resolve([]);
      await expect(newLookup).resolves.toEqual({ kind: 'unauthorized' });
      await expect(joinedLookup).resolves.toEqual({ kind: 'unauthorized' });
      expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(2);
    });

    it.each(['active', 'revoked'])(
      'preserves a newer cache entry when the invalidated %s lookup completes last',
      async oldStatus => {
        const oldQuery = deferredQuery();
        mockedQueryRowsWithPgSystemContext
          .mockImplementationOnce(() => oldQuery.promise)
          .mockResolvedValueOnce(activeRows());
        const request = createRequest({ cookie: 'session_token=racing-token' });
        const config = createConfig();

        const oldLookup = resolveProfileStatusFromSession(request, config);
        invalidateSessionIdentityTokens(['racing-token']);
        const newResult = await resolveProfileStatusFromSession(
          request,
          config
        );
        expect(newResult).toMatchObject({
          kind: 'ok',
          identity: { role: 'user' },
        });

        oldQuery.resolve(
          oldStatus === 'active' ? activeRows(startedAt + 60_000, 'admin') : []
        );
        await oldLookup;
        await expect(
          resolveProfileStatusFromSession(request, config)
        ).resolves.toEqual(newResult);
        expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(2);
      }
    );

    it('invalidates every matching candidate key without evicting unrelated tokens', async () => {
      mockedQueryRowsWithPgSystemContext
        .mockResolvedValueOnce(activeRows())
        .mockResolvedValueOnce(activeRows())
        .mockResolvedValueOnce(activeRows())
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const signedRequest = createRequest({
        cookie: 'session_token=revoked-token.signature',
      });
      const bearerRequest = createRequest({
        authorization: 'Bearer revoked-token',
      });
      const unrelatedRequest = createRequest({
        cookie: 'session_token=unrelated-token',
      });
      const config = createConfig();

      await resolveProfileStatusFromSession(signedRequest, config);
      await resolveProfileStatusFromSession(bearerRequest, config);
      const unrelatedResult = await resolveProfileStatusFromSession(
        unrelatedRequest,
        config
      );
      expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(3);
      invalidateSessionIdentityTokens(['revoked-token']);

      await expect(
        resolveProfileStatusFromSession(signedRequest, config)
      ).resolves.toEqual({ kind: 'unauthorized' });
      await expect(
        resolveProfileStatusFromSession(bearerRequest, config)
      ).resolves.toEqual({ kind: 'unauthorized' });
      await expect(
        resolveProfileStatusFromSession(unrelatedRequest, config)
      ).resolves.toEqual(unrelatedResult);
      expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(5);
    });

    it.each(['1000', '60000'])(
      'bounds the cache window to one second from query start with TTL=%s',
      async configuredTtl => {
        process.env.FASTIFY_SESSION_IDENTITY_CACHE_TTL_MS = configuredTtl;
        const query = deferredQuery();
        mockedQueryRowsWithPgSystemContext
          .mockImplementationOnce(() => query.promise)
          .mockResolvedValueOnce([]);
        const request = createRequest({ cookie: 'session_token=slow-token' });
        const config = createConfig();

        const lookup = resolveProfileStatusFromSession(request, config);
        jest.setSystemTime(startedAt + 900);
        query.resolve(activeRows());
        const result = await lookup;
        expect(result.kind).toBe('ok');

        jest.setSystemTime(startedAt + 999);
        await expect(
          resolveProfileStatusFromSession(request, config)
        ).resolves.toEqual(result);
        expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(1);

        jest.setSystemTime(startedAt + 1000);
        await expect(
          resolveProfileStatusFromSession(request, config)
        ).resolves.toEqual({ kind: 'unauthorized' });
        expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(2);
      }
    );

    it.each([1000, 1500])(
      'does not cache a query that completes after %i ms',
      async elapsedMs => {
        const query = deferredQuery();
        mockedQueryRowsWithPgSystemContext
          .mockImplementationOnce(() => query.promise)
          .mockResolvedValueOnce([]);
        const request = createRequest({ cookie: 'session_token=slow-token' });
        const config = createConfig();

        const lookup = resolveProfileStatusFromSession(request, config);
        jest.setSystemTime(startedAt + elapsedMs);
        query.resolve(activeRows());
        await expect(lookup).resolves.toMatchObject({ kind: 'ok' });
        await expect(
          resolveProfileStatusFromSession(request, config)
        ).resolves.toEqual({ kind: 'unauthorized' });
        expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(2);
      }
    );

    it('expires the cached identity at session expiry instead of the TTL deadline', async () => {
      mockedQueryRowsWithPgSystemContext
        .mockResolvedValueOnce(activeRows(startedAt + 250))
        .mockResolvedValueOnce([]);
      const request = createRequest({ cookie: 'session_token=expiring-token' });
      const config = createConfig();
      const result = await resolveProfileStatusFromSession(request, config);
      expect(result).toMatchObject({
        kind: 'ok',
        identity: { sessionExpiresAt: new Date(startedAt + 250).toISOString() },
      });

      jest.setSystemTime(startedAt + 249);
      await expect(
        resolveProfileStatusFromSession(request, config)
      ).resolves.toEqual(result);
      expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(1);

      jest.setSystemTime(startedAt + 250);
      await expect(
        resolveProfileStatusFromSession(request, config)
      ).resolves.toEqual({ kind: 'unauthorized' });
      expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(2);
    });

    it('does not cache a session that expires during the database lookup', async () => {
      const query = deferredQuery();
      mockedQueryRowsWithPgSystemContext
        .mockImplementationOnce(() => query.promise)
        .mockResolvedValueOnce([]);
      const request = createRequest({ cookie: 'session_token=expiring-token' });
      const config = createConfig();

      const lookup = resolveProfileStatusFromSession(request, config);
      jest.setSystemTime(startedAt + 250);
      query.resolve(activeRows(startedAt + 250));
      await lookup;
      await expect(
        resolveProfileStatusFromSession(request, config)
      ).resolves.toEqual({ kind: 'unauthorized' });
      expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(2);
    });

    it('honors a configured TTL shorter than one second', async () => {
      process.env.FASTIFY_SESSION_IDENTITY_CACHE_TTL_MS = '100';
      mockedQueryRowsWithPgSystemContext
        .mockResolvedValueOnce(activeRows())
        .mockResolvedValueOnce([]);
      const request = createRequest({
        cookie: 'session_token=short-cache-token',
      });
      const config = createConfig();
      const result = await resolveProfileStatusFromSession(request, config);
      expect(result.kind).toBe('ok');

      jest.setSystemTime(startedAt + 99);
      await expect(
        resolveProfileStatusFromSession(request, config)
      ).resolves.toEqual(result);
      expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(1);

      jest.setSystemTime(startedAt + 100);
      await expect(
        resolveProfileStatusFromSession(request, config)
      ).resolves.toEqual({ kind: 'unauthorized' });
      expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(2);
    });

    it('disables completed-result caching when TTL is zero', async () => {
      process.env.FASTIFY_SESSION_IDENTITY_CACHE_TTL_MS = '0';
      mockedQueryRowsWithPgSystemContext
        .mockResolvedValueOnce(activeRows())
        .mockResolvedValueOnce([]);
      const request = createRequest({ cookie: 'session_token=uncached-token' });
      const config = createConfig();

      await expect(
        resolveProfileStatusFromSession(request, config)
      ).resolves.toMatchObject({ kind: 'ok' });
      await expect(
        resolveProfileStatusFromSession(request, config)
      ).resolves.toEqual({ kind: 'unauthorized' });
      expect(mockedQueryRowsWithPgSystemContext).toHaveBeenCalledTimes(2);
    });
  });
});
