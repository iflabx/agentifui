/** @jest-environment node */
import {
  buildUpdateSetClause,
  buildUserFilterWhereClause,
  escapeLikePattern,
} from '@lib/db/users/query-helpers';

describe('users query helpers', () => {
  it('escapes like wildcards', () => {
    expect(escapeLikePattern('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });

  it('builds filter clauses in parameter order', () => {
    expect(
      buildUserFilterWhereClause({
        role: 'admin',
        status: 'active',
        auth_source: 'sso',
        search: 'alice_100%',
      })
    ).toEqual({
      sql: "WHERE p.role = $1 AND p.status = $2 AND p.auth_source = $3 AND (p.full_name ILIKE $4 ESCAPE '\\' OR p.username ILIKE $4 ESCAPE '\\')",
      params: ['admin', 'active', 'sso', '%alice\\_100\\%%'],
    });
  });

  it('skips empty filters and undefined updates', () => {
    expect(buildUserFilterWhereClause({})).toEqual({ sql: '', params: [] });
    expect(
      buildUpdateSetClause({
        full_name: 'Alice',
        username: undefined,
        status: 'active',
      })
    ).toEqual({
      clause: 'full_name = $1, status = $2',
      values: ['Alice', 'active'],
    });
  });
});
