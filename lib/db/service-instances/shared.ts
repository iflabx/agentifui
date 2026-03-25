import { cacheService } from '@lib/services/db/cache-service';
import { dataService } from '@lib/services/db/data-service';
import { SubscriptionKeys } from '@lib/services/db/realtime-service';

import { IS_BROWSER, type QueryClient, type RealtimeRow } from './types';

export { cacheService, dataService, SubscriptionKeys };

export async function lockProviderRow(
  client: QueryClient,
  providerId: string
): Promise<void> {
  await client.query(
    `
      SELECT id::text AS id
      FROM providers
      WHERE id = $1::uuid
      FOR UPDATE
    `,
    [providerId]
  );
}

export async function ensureProviderDefaultInstance(
  client: QueryClient,
  providerId: string,
  options: {
    preferredId?: string | null;
    excludeId?: string | null;
  } = {}
): Promise<string | null> {
  const existingDefaultResult = await client.query<{ id: string }>(
    `
      SELECT id::text AS id
      FROM service_instances
      WHERE provider_id = $1::uuid
        AND is_default = TRUE
      LIMIT 1
    `,
    [providerId]
  );
  const existingDefaultId = existingDefaultResult.rows[0]?.id || null;
  if (existingDefaultId) {
    return existingDefaultId;
  }

  const preferredId = options.preferredId?.trim() || '';
  const excludeId = options.excludeId?.trim() || '';

  let targetId: string | null = null;
  if (preferredId && preferredId !== excludeId) {
    const preferredResult = await client.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM service_instances
        WHERE provider_id = $1::uuid
          AND id = $2::uuid
        LIMIT 1
      `,
      [providerId, preferredId]
    );
    targetId = preferredResult.rows[0]?.id || null;
  }

  if (!targetId) {
    const fallbackResult = excludeId
      ? await client.query<{ id: string }>(
          `
            SELECT id::text AS id
            FROM service_instances
            WHERE provider_id = $1::uuid
              AND id <> $2::uuid
            ORDER BY created_at ASC, id ASC
            LIMIT 1
          `,
          [providerId, excludeId]
        )
      : await client.query<{ id: string }>(
          `
            SELECT id::text AS id
            FROM service_instances
            WHERE provider_id = $1::uuid
            ORDER BY created_at ASC, id ASC
            LIMIT 1
          `,
          [providerId]
        );
    targetId = fallbackResult.rows[0]?.id || null;
  }

  if (!targetId && excludeId) {
    const forceFallbackResult = await client.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM service_instances
        WHERE provider_id = $1::uuid
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [providerId]
    );
    targetId = forceFallbackResult.rows[0]?.id || null;
  }

  if (!targetId) {
    return null;
  }

  await client.query(
    `
      UPDATE service_instances
      SET is_default = TRUE,
          updated_at = NOW()
      WHERE id = $1::uuid
    `,
    [targetId]
  );

  return targetId;
}

export async function publishServiceInstanceChangeBestEffort(input: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: RealtimeRow | null;
  oldRow: RealtimeRow | null;
}) {
  if (IS_BROWSER) {
    return;
  }

  try {
    const runtimeRequire = eval('require') as (id: string) => unknown;
    const publisherModule = runtimeRequire(
      '../../server/realtime/publisher'
    ) as {
      publishTableChangeEvent?: (payload: {
        table: string;
        eventType: 'INSERT' | 'UPDATE' | 'DELETE';
        newRow: RealtimeRow | null;
        oldRow: RealtimeRow | null;
      }) => Promise<void>;
    };
    const publisher = publisherModule.publishTableChangeEvent;
    if (typeof publisher !== 'function') {
      return;
    }

    await publisher({
      table: 'service_instances',
      eventType: input.eventType,
      oldRow: input.oldRow,
      newRow: input.newRow,
    });
  } catch (error) {
    console.warn('[ServiceInstancesDB] Realtime publish failed:', error);
  }
}
