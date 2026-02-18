/** @jest-environment node */
const connectMock = jest.fn();
const poolConstructorMock = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation((...args: unknown[]) => {
    poolConstructorMock(...args);
    return {
      connect: connectMock,
    };
  }),
}));

function createClient() {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('SELECT COALESCE(role::text')) {
      return { rows: [{ role: 'user' }] };
    }
    return { rows: [] };
  });
  const release = jest.fn();
  return {
    query,
    release,
  };
}

describe('fastify pg-context strict mode injection', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalStrictMode = process.env.APP_RLS_STRICT_MODE;
  const globalState = globalThis as unknown as Record<string, unknown>;
  const globalPoolKey = '__agentifui_fastify_pg_pool__';

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete globalState[globalPoolKey];
    process.env.DATABASE_URL =
      'postgresql://agentif_app:agentif_app@127.0.0.1:5432/agentifui';
  });

  afterAll(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalStrictMode === undefined) {
      delete process.env.APP_RLS_STRICT_MODE;
    } else {
      process.env.APP_RLS_STRICT_MODE = originalStrictMode;
    }
    delete globalState[globalPoolKey];
  });

  it('injects app.rls_strict_mode when APP_RLS_STRICT_MODE=1', async () => {
    process.env.APP_RLS_STRICT_MODE = '1';
    const client = createClient();
    connectMock.mockResolvedValue(client);

    const { runWithPgRlsContext } = await import('./pg-context');
    await runWithPgRlsContext(
      { userId: '00000000-0000-4000-8000-000000000001' },
      async () => 'ok'
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.rls_strict_mode'"),
      ['on']
    );
  });

  it('does not set strict mode when APP_RLS_STRICT_MODE is unset', async () => {
    delete process.env.APP_RLS_STRICT_MODE;
    const client = createClient();
    connectMock.mockResolvedValue(client);

    const { runWithPgRlsContext } = await import('./pg-context');
    await runWithPgRlsContext(
      { userId: '00000000-0000-4000-8000-000000000001' },
      async () => 'ok'
    );

    const strictModeCall = client.query.mock.calls.find(call =>
      String(call[0]).includes("set_config('app.rls_strict_mode'")
    );
    expect(strictModeCall).toBeUndefined();
  });
});
