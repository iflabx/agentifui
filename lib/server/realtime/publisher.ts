import {
  type RealtimeDbChangePayload,
  type RealtimeRow,
  deriveRealtimeKeysForTableChange,
} from '@lib/services/db/realtime-service';

import { publishRealtimeEvent } from './redis-broker';

export async function publishTableChangeEvent(input: {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: RealtimeRow | null;
  oldRow: RealtimeRow | null;
  schema?: string;
  commitTimestamp?: string;
}): Promise<void> {
  const payload: RealtimeDbChangePayload = {
    schema: input.schema || 'public',
    table: input.table,
    eventType: input.eventType,
    commitTimestamp: input.commitTimestamp || new Date().toISOString(),
    new: input.newRow,
    old: input.oldRow,
  };

  const keys = deriveRealtimeKeysForTableChange({
    table: input.table,
    newRow: input.newRow,
    oldRow: input.oldRow,
  });

  if (keys.length === 0) {
    return;
  }

  await Promise.all(
    keys.map(async key => {
      await publishRealtimeEvent({ key, payload });
    })
  );
}
