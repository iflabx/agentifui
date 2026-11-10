import { runWithPgSystemContext } from '@lib/server/pg/user-context';
import { Result, failure, success } from '@lib/types/result';

import { INTERNAL_AUTH_PROVIDER } from './constants';
import type { SessionUser } from './types';

export async function resolveTrustedSessionUser(
  sessionUser: SessionUser
): Promise<Result<SessionUser>> {
  try {
    const { rows } = await runWithPgSystemContext(client =>
      client.query<{ provider_id: string }>(
        `SELECT DISTINCT provider_id FROM auth_accounts WHERE user_id::text = $1`,
        [sessionUser.id]
      )
    );
    const external = rows
      .map(row => row.provider_id)
      .filter(provider => provider && provider !== 'credential');
    const provider =
      external.length > 1
        ? 'external'
        : external[0] ||
          (rows.some(row => row.provider_id === 'credential')
            ? INTERNAL_AUTH_PROVIDER
            : 'unknown');
    const metadata = sessionUser.app_metadata;
    return success({
      ...sessionUser,
      provider,
      auth_source: provider,
      app_metadata: {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        provider,
      },
    });
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to resolve account provider')
    );
  }
}
