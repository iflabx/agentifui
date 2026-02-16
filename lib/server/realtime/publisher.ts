import {
  type RealtimeDbChangePayload,
  type RealtimeRow,
  deriveRealtimeKeysForTableChange,
} from '@lib/services/db/realtime-service';

import { ensureRealtimeOutboxDispatcher } from './outbox-dispatcher';
import { publishRealtimeEvent } from './redis-broker';

function resolveRealtimeSourceMode(): 'db-outbox' | 'app-direct' | 'hybrid' {
  const normalized = (process.env.REALTIME_SOURCE_MODE || 'db-outbox')
    .trim()
    .toLowerCase();

  if (normalized === 'app-direct') {
    return 'app-direct';
  }

  if (normalized === 'hybrid') {
    return 'hybrid';
  }

  return 'db-outbox';
}

export async function publishTableChangeEvent(input: {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: RealtimeRow | null;
  oldRow: RealtimeRow | null;
  schema?: string;
  commitTimestamp?: string;
}): Promise<void> {
  // Keep dispatcher alive so DB outbox events can be forwarded to Redis/SSE.
  ensureRealtimeOutboxDispatcher();

  const sourceMode = resolveRealtimeSourceMode();
  if (sourceMode === 'db-outbox') {
    // In DB outbox mode, publish is emitted by PG trigger + outbox dispatcher.
    return;
  }

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
