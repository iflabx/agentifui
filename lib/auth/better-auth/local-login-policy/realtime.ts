import { queryRowsWithPolicyContext } from './context';
import { toProfileRealtimeRow } from './helpers';
import type {
  LocalLoginPolicyContext,
  ProfileLocalLoginStateRow,
  RealtimePublisher,
  RealtimeRow,
} from './types';

export async function publishProfileChangeBestEffort(input: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  oldRow: RealtimeRow | null;
  newRow: RealtimeRow | null;
}): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  try {
    const publisherModule = (await import(
      '@lib/server/realtime/publisher'
    )) as {
      publishTableChangeEvent?: RealtimePublisher;
    };
    const publisher = publisherModule.publishTableChangeEvent;
    if (typeof publisher !== 'function') {
      return;
    }

    await publisher({
      table: 'profiles',
      eventType: input.eventType,
      oldRow: input.oldRow,
      newRow: input.newRow,
    });
  } catch (error) {
    console.warn('[AuthLocalLoginPolicy] failed to publish profile realtime:', {
      error,
      eventType: input.eventType,
    });
  }
}

export async function loadProfileRealtimeRowByUserId(
  userId: string,
  context: LocalLoginPolicyContext
): Promise<ProfileLocalLoginStateRow | null> {
  const rows = await queryRowsWithPolicyContext<ProfileLocalLoginStateRow>(
    `
      SELECT
        id::text AS id,
        email,
        auth_source,
        local_login_enabled,
        local_login_updated_at,
        fallback_password_set_at,
        fallback_password_updated_by::text AS fallback_password_updated_by,
        updated_at
      FROM profiles
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [userId],
    context
  );
  return rows[0] || null;
}

export { toProfileRealtimeRow };
