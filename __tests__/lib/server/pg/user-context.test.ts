/** @jest-environment node */
import { getPgPool } from '@lib/server/pg/pool';
import { runWithPgRlsContext } from '@lib/server/pg/user-context';

jest.mock('@lib/server/pg/pool', () => ({ getPgPool: jest.fn() }));

const originalStrictMode = process.env.APP_RLS_STRICT_MODE;
const query = jest.fn();
const release = jest.fn();
const client = { query, release };

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
  (getPgPool as jest.Mock).mockReturnValue({
    connect: jest.fn().mockResolvedValue(client),
  });
  delete process.env.APP_RLS_STRICT_MODE;
});

afterEach(() => {
  if (originalStrictMode === undefined) {
    delete process.env.APP_RLS_STRICT_MODE;
  } else {
    process.env.APP_RLS_STRICT_MODE = originalStrictMode;
  }
});

test.each(['1', 'true', 'yes', ' ON '])(
  'sets transaction-local strict mode before resolving the actor (%s)',
  async value => {
    process.env.APP_RLS_STRICT_MODE = value;
    const operation = jest.fn().mockResolvedValue('done');

    await expect(
      runWithPgRlsContext({ userId: 'test-user' }, operation)
    ).resolves.toBe('done');

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenNthCalledWith(
      2,
      "SELECT set_config('app.rls_strict_mode', $1::text, true)",
      ['on']
    );
    expect(operation).toHaveBeenCalledWith(client);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  }
);

test.each(['0', 'false', 'no', ' OFF '])(
  'honors explicitly disabled strict mode (%s)',
  async value => {
    process.env.APP_RLS_STRICT_MODE = value;
    await runWithPgRlsContext({}, async () => undefined);
    expect(query).toHaveBeenNthCalledWith(
      2,
      "SELECT set_config('app.rls_strict_mode', $1::text, true)",
      ['off']
    );
  }
);

test.each([undefined, '', 'invalid'])(
  'preserves database defaults when strict mode is unspecified (%s)',
  async value => {
    if (value !== undefined) {
      process.env.APP_RLS_STRICT_MODE = value;
    }
    await runWithPgRlsContext({}, async () => undefined);
    expect(
      query.mock.calls.some(([sql]) => sql.includes('app.rls_strict_mode'))
    ).toBe(false);
  }
);

test('rolls back and releases the connection when the operation fails', async () => {
  process.env.APP_RLS_STRICT_MODE = '1';
  const failure = new Error('operation failed');
  await expect(
    runWithPgRlsContext({}, async () => {
      throw failure;
    })
  ).rejects.toBe(failure);
  expect(query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(release).toHaveBeenCalledTimes(1);
});

test('rolls back without running the operation if strict setup fails', async () => {
  process.env.APP_RLS_STRICT_MODE = '1';
  const failure = new Error('strict setup failed');
  query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(failure);
  const operation = jest.fn();
  await expect(runWithPgRlsContext({}, operation)).rejects.toBe(failure);
  expect(operation).not.toHaveBeenCalled();
  expect(query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(release).toHaveBeenCalledTimes(1);
});
