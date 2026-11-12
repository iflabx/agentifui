/** @jest-environment node */
import { EventEmitter } from 'node:events';

import {
  readRealtimeEventsSince,
  subscribeRealtimeEvents,
} from '../lib/realtime/broker';
import { registerRealtimeSubscription } from '../lib/realtime/subscription-registry';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { internalRealtimeStreamRoutes } from './internal-realtime-stream';

jest.mock('../lib/pg-context', () => ({
  queryRowsWithPgUserContext: jest.fn(),
}));
jest.mock('../lib/session-identity', () => ({
  resolveIdentityFromSession: jest.fn(),
}));
jest.mock('../lib/realtime/broker', () => ({
  subscribeRealtimeEvents: jest.fn(),
  readRealtimeEventsSince: jest.fn(),
}));
jest.mock('../lib/realtime/subscription-registry', () => ({
  registerRealtimeSubscription: jest.fn(),
}));
jest.mock('../lib/realtime/outbox-dispatcher', () => ({
  ensureRealtimeOutboxDispatcher: jest.fn(),
}));

describe('realtime subscription lifecycle', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  async function setup() {
    const raw = new EventEmitter();
    const response = Object.assign(new EventEmitter(), {
      statusCode: 0,
      writableEnded: false,
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(() => {
        response.writableEnded = true;
      }),
    });
    const unsubscribe = jest.fn();
    const unregister = jest.fn();
    jest.mocked(resolveIdentityFromSession).mockResolvedValue({
      kind: 'ok',
      identity: { userId: 'test-user', role: 'user' },
    });
    jest.mocked(registerRealtimeSubscription).mockReturnValue(unregister);
    jest.mocked(subscribeRealtimeEvents).mockResolvedValue(unsubscribe);
    jest.mocked(readRealtimeEventsSince).mockResolvedValue([]);
    let handler!: (request: unknown, reply: unknown) => Promise<unknown>;
    await internalRealtimeStreamRoutes(
      {
        get: (_path: string, callback: typeof handler) => {
          handler = callback;
        },
      } as never,
      { config: {} } as never
    );
    const run = (lastEventId?: string) =>
      handler(
        {
          id: 'test-request',
          headers: {},
          raw,
          query: { key: 'sidebar-conversations:test-user', lastEventId },
          log: { warn: jest.fn() },
        },
        { hijack: jest.fn(), raw: response }
      );
    return { raw, response, unsubscribe, unregister, run };
  }

  it('unsubscribes exactly once when disconnected during subscription establishment', async () => {
    const test = await setup();
    jest.mocked(subscribeRealtimeEvents).mockImplementation(async () => {
      test.raw.emit('aborted');
      return test.unsubscribe;
    });
    await test.run('previous-event');
    test.raw.emit('close');
    test.response.emit('close');
    expect(test.unsubscribe).toHaveBeenCalledTimes(1);
    expect(test.unregister).toHaveBeenCalledTimes(1);
    expect(readRealtimeEventsSince).not.toHaveBeenCalled();
    expect(test.response.end).toHaveBeenCalledTimes(1);
  });

  it('cleans registry and timers when establishment fails', async () => {
    const test = await setup();
    jest
      .mocked(subscribeRealtimeEvents)
      .mockRejectedValue(new Error('Unavailable subscriber'));
    await test.run();
    expect(test.unregister).toHaveBeenCalledTimes(1);
    expect(test.response.end).toHaveBeenCalledTimes(1);
  });

  it('cleans an established subscription after response disconnect and repeated close', async () => {
    const test = await setup();
    await test.run();
    expect(jest.getTimerCount()).toBe(1);
    test.response.emit('close');
    test.raw.emit('aborted');
    expect(test.unsubscribe).toHaveBeenCalledTimes(1);
    expect(test.unregister).toHaveBeenCalledTimes(1);
    expect(test.raw.listenerCount('aborted')).toBe(0);
    expect(test.response.listenerCount('close')).toBe(0);
  });

  it('cleans up when replay fails', async () => {
    const test = await setup();
    jest
      .mocked(readRealtimeEventsSince)
      .mockRejectedValue(new Error('Replay failed'));
    await test.run('previous-event');
    expect(test.unsubscribe).toHaveBeenCalledTimes(1);
    expect(test.unregister).toHaveBeenCalledTimes(1);
  });

  it('does not send replay results after a disconnect during replay', async () => {
    const test = await setup();
    jest.mocked(readRealtimeEventsSince).mockImplementation(async () => {
      test.raw.emit('aborted');
      return [
        { id: 'event-1', key: 'sidebar-conversations:test-user', payload: {} },
      ] as never;
    });
    await test.run('previous-event');
    expect(test.response.write).toHaveBeenCalledTimes(1);
    expect(test.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
