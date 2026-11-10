/** @jest-environment node */
import { RedisManager } from '@lib/infra/redis/manager';

const mockClient = {
  isOpen: true,
  on: jest.fn(),
  getDel: jest.fn(),
  eval: jest.fn(),
};

jest.mock('redis', () => ({ createClient: () => mockClient }));

const manager = new RedisManager('test-prefix');

beforeEach(() => {
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  delete (globalThis as Record<string, unknown>).__agentifui_redis_client__;
  mockClient.getDel.mockReset();
  mockClient.eval.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__agentifui_redis_client__;
  delete process.env.REDIS_URL;
});

test('uses a single atomic GETDEL operation with the application prefix', async () => {
  mockClient.getDel.mockResolvedValue('one-time-value');
  await expect(manager.getAndDelete('verification')).resolves.toBe(
    'one-time-value'
  );
  expect(mockClient.getDel).toHaveBeenCalledWith('test-prefix:verification');
});

test('increments and initializes expiry in one atomic script', async () => {
  mockClient.eval.mockResolvedValue(2);
  await expect(manager.increment('rate-limit', 30)).resolves.toBe(2);
  const [script, options] = mockClient.eval.mock.calls[0];
  expect(script).toContain("redis.call('INCR', KEYS[1])");
  expect(script).toContain("if count == 1 then redis.call('EXPIRE'");
  expect(options).toEqual({
    keys: ['test-prefix:rate-limit'],
    arguments: ['30'],
  });
});

test.each([0, -1, NaN, Infinity])(
  'rejects invalid counter expiry %s',
  async ttl => {
    await expect(manager.increment('rate-limit', ttl)).rejects.toThrow(
      'TTL must be positive'
    );
    expect(mockClient.eval).not.toHaveBeenCalled();
  }
);

test('does not silently accept an invalid Redis script result', async () => {
  mockClient.eval.mockResolvedValue('invalid');
  await expect(manager.increment('rate-limit', 30)).rejects.toThrow(
    'invalid result'
  );
});
