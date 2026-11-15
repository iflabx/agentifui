/** @jest-environment node */
import type { Pool } from 'pg';

import { createTestRole, dropTestRole } from './helpers/test-role';

function fixture() {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const release = jest.fn();
  const connect = jest.fn().mockResolvedValue({ query, release });
  return {
    database: { connect } as unknown as Pool,
    query,
    release,
    connect,
  };
}

it('serializes role creation and grants in one locked transaction', async () => {
  const test = fixture();
  await createTestRole(test.database, 'synthetic_role');
  expect(test.query.mock.calls.map(call => call[0])).toEqual([
    'BEGIN',
    'SELECT pg_advisory_xact_lock(1735289204, 1)',
    'CREATE ROLE "synthetic_role" NOLOGIN NOSUPERUSER NOBYPASSRLS',
    'GRANT USAGE ON SCHEMA public TO "synthetic_role"',
    'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "synthetic_role"',
    'GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO "synthetic_role"',
    'COMMIT',
  ]);
  expect(test.release).toHaveBeenCalledTimes(1);
});

it('uses the same lock for privilege removal and role cleanup', async () => {
  const test = fixture();
  await dropTestRole(test.database, 'synthetic_role');
  expect(test.query.mock.calls.map(call => call[0])).toEqual([
    'BEGIN',
    'SELECT pg_advisory_xact_lock(1735289204, 1)',
    'DROP OWNED BY "synthetic_role"',
    'DROP ROLE "synthetic_role"',
    'COMMIT',
  ]);
  expect(test.release).toHaveBeenCalledTimes(1);
});

it('rolls back and releases the dedicated client after catalog failure', async () => {
  const test = fixture();
  const error = new Error('synthetic catalog failure');
  test.query.mockResolvedValueOnce({ rows: [] });
  test.query.mockResolvedValueOnce({ rows: [] });
  test.query.mockRejectedValueOnce(error);
  await expect(createTestRole(test.database, 'synthetic_role')).rejects.toBe(
    error
  );
  expect(test.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(test.query).not.toHaveBeenCalledWith('COMMIT');
  expect(test.release).toHaveBeenCalledTimes(1);
});

it.each([createTestRole, dropTestRole])(
  'rejects unsafe role identifiers before connecting',
  async operation => {
    const test = fixture();
    await expect(operation(test.database, 'role; SELECT 1')).rejects.toThrow(
      'Invalid test role identifier'
    );
    expect(test.connect).not.toHaveBeenCalled();
  }
);
