/** @jest-environment node */
import { createBetterAuthSecondaryStorage } from '@lib/auth/better-auth/secondary-storage';
import { getAuthSessionConfig } from '@lib/auth/better-auth/server/config';
import { redisManager } from '@lib/infra/redis';
import { getPgPool } from '@lib/server/pg/pool';

jest.mock('@lib/infra/redis', () => ({
  redisManager: {
    get: jest.fn(),
    getAndDelete: jest.fn(),
    increment: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('@lib/server/pg/pool', () => ({
  getPgPool: jest.fn(),
}));

const storage = createBetterAuthSecondaryStorage();
const query = jest.fn();
const lookupToken = 'session-token';
const sessionId = '00000000-0000-4000-8000-000000000001';
const authUserId = '00000000-0000-4000-8000-000000000002';

function createCachedSession() {
  return {
    session: {
      id: sessionId,
      token: lookupToken,
      userId: authUserId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    user: { id: authUserId },
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getPgPool).mockReturnValue({
    query,
  } as unknown as ReturnType<typeof getPgPool>);
  query.mockResolvedValue({
    rows: [{ expires_at: new Date(Date.now() + 60_000) }],
  });
});

test('returns a session hit only after checking its exact database identity', async () => {
  const cached = JSON.stringify(createCachedSession());
  jest.mocked(redisManager.get).mockResolvedValue(cached);

  await expect(storage.get(lookupToken)).resolves.toBe(cached);
  expect(redisManager.get).toHaveBeenCalledWith(
    `better-auth:secondary:${lookupToken}`
  );
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining('FROM auth_sessions'),
    [lookupToken, sessionId, authUserId]
  );
  const sql = query.mock.calls[0][0];
  expect(sql).toContain('token = $1::text');
  expect(sql).toContain('id::text = $2::text');
  expect(sql).toContain('user_id::text = $3::text');
  expect(sql).toContain('expires_at > CURRENT_TIMESTAMP');
});

test('rechecks PostgreSQL even when the same Redis payload survives revocation', async () => {
  const cached = JSON.stringify(createCachedSession());
  jest.mocked(redisManager.get).mockResolvedValue(cached);
  query
    .mockResolvedValueOnce({
      rows: [{ expires_at: new Date(Date.now() + 60_000) }],
    })
    .mockResolvedValueOnce({ rows: [] });

  await expect(storage.get(lookupToken)).resolves.toBe(cached);
  await expect(storage.get(lookupToken)).resolves.toBeNull();
  expect(query).toHaveBeenCalledTimes(2);
  expect(redisManager.del).not.toHaveBeenCalled();
});

test.each(['id', 'userId'] as const)(
  'requires the cached session %s to match the database row',
  async field => {
    const cached = createCachedSession();
    cached.session[field] = 'another-identity';
    if (field === 'userId') {
      cached.user.id = cached.session.userId;
    }
    jest.mocked(redisManager.get).mockResolvedValue(JSON.stringify(cached));
    query.mockResolvedValue({ rows: [] });

    await expect(storage.get(lookupToken)).resolves.toBeNull();
    expect(query.mock.calls[0][1]).toEqual([
      lookupToken,
      cached.session.id,
      cached.session.userId,
    ]);
  }
);

test.each([
  ['lookup token', { token: 'another-token' }, {}],
  ['session id', { id: '' }, {}],
  ['whitespace session id', { id: ' ' }, {}],
  ['numeric session id', { id: 1 }, {}],
  ['auth user id', { userId: '' }, {}],
  ['whitespace auth user id', { userId: ' ' }, {}],
  ['cached user', {}, { id: 'another-user' }],
  ['expiry', { expiresAt: 'invalid-date' }, {}],
  ['expired cache', { expiresAt: '2000-01-01T00:00:00.000Z' }, {}],
  ['numeric expiry', { expiresAt: 123456789 }, {}],
  ['null expiry', { expiresAt: null }, {}],
])(
  'misses invalid %s without querying PostgreSQL',
  async (_description, session, user) => {
    const cached = createCachedSession();
    jest.mocked(redisManager.get).mockResolvedValue(
      JSON.stringify({
        session: { ...cached.session, ...session },
        user: { ...cached.user, ...user },
      })
    );

    await expect(storage.get(lookupToken)).resolves.toBeNull();
    expect(getPgPool).not.toHaveBeenCalled();
  }
);

test.each([
  '',
  'not-json',
  'null',
  '[]',
  '42',
  '"text"',
  '{}',
  '{"count":1}',
  '{"session":null}',
  '{"session":[],"user":{}}',
  '{"session":{},"user":null}',
])('treats unrecognized session payload %s as a cache miss', async value => {
  jest.mocked(redisManager.get).mockResolvedValue(value);

  await expect(storage.get(lookupToken)).resolves.toBeNull();
  expect(getPgPool).not.toHaveBeenCalled();
});

test.each([
  new Date('2000-01-01T00:00:00.000Z'),
  '2000-01-01T00:00:00.000Z',
  'invalid-date',
])('rejects a database expiry that is not live: %s', async expiresAt => {
  jest
    .mocked(redisManager.get)
    .mockResolvedValue(JSON.stringify(createCachedSession()));
  query.mockResolvedValue({ rows: [{ expires_at: expiresAt }] });

  await expect(storage.get(lookupToken)).resolves.toBeNull();
});

test('accepts live database expiry serialized as text', async () => {
  const cached = createCachedSession();
  const value = JSON.stringify(cached);
  jest.mocked(redisManager.get).mockResolvedValue(value);
  query.mockResolvedValue({ rows: [{ expires_at: cached.session.expiresAt }] });

  await expect(storage.get(lookupToken)).resolves.toBe(value);
});

test('rejects a cached session that expires while PostgreSQL is queried', async () => {
  const cached = createCachedSession();
  const expiresAt = Date.parse(cached.session.expiresAt);
  jest.mocked(redisManager.get).mockResolvedValue(JSON.stringify(cached));
  const now = jest.spyOn(Date, 'now').mockReturnValue(expiresAt - 1);
  query.mockImplementationOnce(async () => {
    now.mockReturnValue(expiresAt);
    return { rows: [{ expires_at: new Date(expiresAt + 60_000) }] };
  });

  try {
    await expect(storage.get(lookupToken)).resolves.toBeNull();
  } finally {
    now.mockRestore();
  }
});

test('rejects a database session that expires before the query resolves', async () => {
  const cached = createCachedSession();
  const expiresAt = Date.parse(cached.session.expiresAt) - 30_000;
  jest.mocked(redisManager.get).mockResolvedValue(JSON.stringify(cached));
  const now = jest.spyOn(Date, 'now').mockReturnValue(expiresAt - 1);
  query.mockImplementationOnce(async () => {
    now.mockReturnValue(expiresAt);
    return { rows: [{ expires_at: new Date(expiresAt) }] };
  });

  try {
    await expect(storage.get(lookupToken)).resolves.toBeNull();
  } finally {
    now.mockRestore();
  }
});

test('propagates database errors instead of accepting a Redis identity', async () => {
  jest
    .mocked(redisManager.get)
    .mockResolvedValue(JSON.stringify(createCachedSession()));
  const error = new Error('database unavailable');
  query.mockRejectedValue(error);

  await expect(storage.get(lookupToken)).rejects.toBe(error);
});

test('propagates pool initialization errors', async () => {
  jest
    .mocked(redisManager.get)
    .mockResolvedValue(JSON.stringify(createCachedSession()));
  const error = new Error('pool unavailable');
  jest.mocked(getPgPool).mockImplementation(() => {
    throw error;
  });

  await expect(storage.get(lookupToken)).rejects.toBe(error);
});

test('does not query PostgreSQL for a Redis cache miss', async () => {
  jest.mocked(redisManager.get).mockResolvedValue(null);

  await expect(storage.get(lookupToken)).resolves.toBeNull();
  expect(getPgPool).not.toHaveBeenCalled();
});

test('propagates Redis errors without attempting database validation', async () => {
  const error = new Error('Redis unavailable');
  jest.mocked(redisManager.get).mockRejectedValue(error);

  await expect(storage.get(lookupToken)).rejects.toBe(error);
  expect(getPgPool).not.toHaveBeenCalled();
});

test.each([
  ['verification:email', '{"value":"otp","expiresAt":"later"}'],
  ['verification:custom', '{"session":{"invalid":true}}'],
  ['active-sessions-user', '[{"token":"token","expiresAt":123}]'],
  ['revoked-sessions-before-user', '123456789'],
])(
  'preserves non-session key %s without database validation',
  async (key, value) => {
    jest.mocked(redisManager.get).mockResolvedValue(value);

    await expect(storage.get(key)).resolves.toBe(value);
    expect(getPgPool).not.toHaveBeenCalled();
  }
);

test('delegates single-use reads to atomic Redis consumption', async () => {
  jest.mocked(redisManager.getAndDelete).mockResolvedValue('token');
  await expect(storage.getAndDelete('verification')).resolves.toBe('token');
  expect(redisManager.getAndDelete).toHaveBeenCalledWith(
    'better-auth:secondary:verification'
  );
});

test('delegates rate counters to the fixed-window atomic increment', async () => {
  jest.mocked(redisManager.increment).mockResolvedValue(3);
  await expect(storage.increment('rate-limit', 60)).resolves.toBe(3);
  expect(redisManager.increment).toHaveBeenCalledWith(
    'better-auth:secondary:rate-limit',
    60
  );
});

test('preserves session writes and expiry', async () => {
  await storage.set('session', 'value', 120);
  expect(redisManager.set).toHaveBeenCalledWith(
    'better-auth:secondary:session',
    'value',
    { ttlSeconds: 120 }
  );
});

test('rejects blank keys before invoking atomic storage operations', async () => {
  await expect(storage.getAndDelete(' ')).rejects.toThrow(
    'key cannot be empty'
  );
  await expect(storage.increment(' ', 60)).rejects.toThrow(
    'key cannot be empty'
  );
  expect(redisManager.getAndDelete).not.toHaveBeenCalled();
  expect(redisManager.increment).not.toHaveBeenCalled();
});

describe('database-authoritative session configuration', () => {
  const variableNames = [
    'BETTER_AUTH_STORE_SESSION_IN_DB',
    'BETTER_AUTH_PRESERVE_SESSION_IN_DB',
    'BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS',
    'BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS',
  ] as const;
  const originalValues = variableNames.map(name => process.env[name]);

  beforeEach(() => {
    for (const name of variableNames) {
      delete process.env[name];
    }
  });

  afterEach(() => {
    variableNames.forEach((name, index) => {
      const value = originalValues[index];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  });

  test('requires database storage and explicitly disables cookie caching', () => {
    expect(getAuthSessionConfig()).toMatchObject({
      modelName: 'auth_sessions',
      storeSessionInDatabase: true,
      preserveSessionInDatabase: false,
      cookieCache: { enabled: false },
    });
  });

  test.each(['false', '0', 'no', 'off', ' FALSE '])(
    'rejects disabled database storage: %s',
    value => {
      process.env.BETTER_AUTH_STORE_SESSION_IN_DB = value;
      expect(() => getAuthSessionConfig()).toThrow(
        'database-backed sessions are required'
      );
    }
  );

  test('preserves configured session lifetimes and database preservation', () => {
    process.env.BETTER_AUTH_STORE_SESSION_IN_DB = 'true';
    process.env.BETTER_AUTH_PRESERVE_SESSION_IN_DB = 'true';
    process.env.BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS = '3600';
    process.env.BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS = '0';

    expect(getAuthSessionConfig()).toMatchObject({
      storeSessionInDatabase: true,
      cookieCache: { enabled: false },
      preserveSessionInDatabase: true,
      expiresIn: 3600,
      updateAge: 0,
    });
  });
});
