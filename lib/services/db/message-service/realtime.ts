import type { RealtimeRow } from './types';

const IS_BROWSER = typeof window !== 'undefined';

export async function publishMessageChangeBestEffort(input: {
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
      table: 'messages',
      eventType: input.eventType,
      oldRow: input.oldRow,
      newRow: input.newRow,
    });
  } catch (error) {
    console.warn('[MessageService] Realtime publish failed:', error);
  }
}
