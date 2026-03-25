import { runWithPgUserContext } from '@lib/server/pg/user-context';
import { Result, failure, success } from '@lib/types/result';

import { MISSING_PROFILE_ROW_ERROR_MESSAGE } from '../constants';
import type { ProfileStatusRow } from '../types';

export async function loadProfileStatusReadOnly(userId: string): Promise<
  Result<{
    role: string | null;
    status: string | null;
  }>
> {
  try {
    const queryResult = await runWithPgUserContext(userId, client =>
      client.query<ProfileStatusRow>(
        `
          SELECT
            role::text AS role,
            status::text AS status
          FROM profiles
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [userId]
      )
    );
    const row = queryResult.rows[0];
    if (!row) {
      return failure(new Error(MISSING_PROFILE_ROW_ERROR_MESSAGE));
    }

    return success({
      role: row.role ?? null,
      status: row.status ?? null,
    });
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to load profile status for session user')
    );
  }
}
