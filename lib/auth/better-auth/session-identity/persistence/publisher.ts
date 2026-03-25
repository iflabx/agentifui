import type { RealtimePublisher } from '../types';

export async function publishProfileChangeBestEffort(input: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: Record<string, unknown> | null;
  oldRow: Record<string, unknown> | null;
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
    console.warn(
      '[SessionIdentity] failed to publish profile realtime event:',
      {
        error,
        eventType: input.eventType,
      }
    );
  }
}
