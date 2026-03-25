import { getPgPool } from '@lib/server/pg/pool';
import {
  queryRowsWithPgSystemContext,
  queryRowsWithPgUserContext,
} from '@lib/server/pg/user-context';

import type { LocalLoginPolicyContext } from './types';

export const SYSTEM_POLICY_CONTEXT: LocalLoginPolicyContext = {
  useSystemActor: true,
};

function normalizeActorUserId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function queryRowsWithPolicyContext<T extends object>(
  sql: string,
  params: unknown[] = [],
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<T[]> {
  const actorUserId = normalizeActorUserId(context.actorUserId);
  if (actorUserId) {
    return queryRowsWithPgUserContext<T>(actorUserId, sql, params);
  }

  if (context.useSystemActor !== false) {
    return queryRowsWithPgSystemContext<T>(sql, params);
  }

  const pool = getPgPool();
  const { rows } = await pool.query<T>(sql, params);
  return rows;
}
