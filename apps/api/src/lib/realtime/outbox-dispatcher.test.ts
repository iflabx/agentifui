/** @jest-environment node */
import { getPgPool } from '../pg-context';
import { publishRealtimeEvent } from './broker';
import {
  ensureRealtimeOutboxDispatcher,
  isRealtimeOutboxBusy,
  setRealtimeOutboxPaused,
} from './outbox-dispatcher';

jest.mock('../pg-context', () => ({ getPgPool: jest.fn() }));
jest.mock('./broker', () => ({ publishRealtimeEvent: jest.fn() }));

const stateKey = '__agentifui_fastify_realtime_outbox_dispatcher__';
const originalEnvironment = { ...process.env };
const query = jest.fn();
const settle = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};

beforeEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[stateKey];
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.assign(process.env, { NODE_ENV: 'production' });
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  jest.mocked(getPgPool).mockReturnValue({ query } as never);
  query.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  setRealtimeOutboxPaused(true);
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
  process.env = { ...originalEnvironment };
  delete (globalThis as unknown as Record<string, unknown>)[stateKey];
});

test('pause waits observably for a claimed publish and stops new claims', async () => {
  let release!: () => void;
  const publishing = new Promise<void>(resolve => {
    release = resolve;
  });
  jest.mocked(publishRealtimeEvent).mockReturnValue(publishing as never);
  query.mockResolvedValueOnce({
    rows: [
      {
        id: 1,
        schema_name: 'public',
        table_name: 'providers',
        event_type: 'UPDATE',
        commit_timestamp: new Date().toISOString(),
        new_row: { id: 'fixture' },
        old_row: null,
        attempt_count: 0,
      },
    ],
  });
  try {
    ensureRealtimeOutboxDispatcher();
    await settle();
    expect(publishRealtimeEvent).toHaveBeenCalledTimes(1);
    setRealtimeOutboxPaused(true);
    expect(isRealtimeOutboxBusy()).toBe(true);
    ensureRealtimeOutboxDispatcher();
    await jest.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    release();
    await settle();
    expect(isRealtimeOutboxBusy()).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    setRealtimeOutboxPaused(false);
    await settle();
    expect(query).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(1);
  } finally {
    release();
    await settle();
  }
});

test('pausing an established poller clears the timer and prevents subsequent claims', async () => {
  ensureRealtimeOutboxDispatcher();
  await settle();
  expect(jest.getTimerCount()).toBe(1);
  await jest.advanceTimersByTimeAsync(300);
  expect(query).toHaveBeenCalledTimes(2);
  setRealtimeOutboxPaused(true);
  await jest.advanceTimersByTimeAsync(2000);
  expect(query).toHaveBeenCalledTimes(2);
  expect(isRealtimeOutboxBusy()).toBe(false);
});

test('pausing while the initial claim is pending does not reinstall the poll timer', async () => {
  let release!: (value: { rows: unknown[] }) => void;
  query.mockReturnValueOnce(
    new Promise(resolve => {
      release = resolve;
    })
  );
  ensureRealtimeOutboxDispatcher();
  setRealtimeOutboxPaused(true);
  expect(isRealtimeOutboxBusy()).toBe(true);
  release({ rows: [] });
  await settle();
  expect(isRealtimeOutboxBusy()).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});
