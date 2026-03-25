import { getPgPool } from '@lib/server/pg/pool';
import {
  queryRowsWithPgSystemContext,
  queryRowsWithPgUserContext,
} from '@lib/server/pg/user-context';

import { normalizeActorUserId } from './helpers';
import { IdentityPersistenceContext } from './types';

export async function queryRowsWithIdentityContext<T extends object>(
  sql: string,
  params: unknown[] = [],
  context?: IdentityPersistenceContext
): Promise<T[]> {
  const actorUserId = normalizeActorUserId(context?.actorUserId);
  if (actorUserId) {
    return queryRowsWithPgUserContext<T>(actorUserId, sql, params);
  }

  if (context?.useSystemActor) {
    return queryRowsWithPgSystemContext<T>(sql, params);
  }

  const pool = getPgPool();
  const { rows } = await pool.query<T>(sql, params);
  return rows;
}
