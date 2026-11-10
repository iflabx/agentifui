/** @jest-environment node */
import { createBetterAuthSecondaryStorage } from '@lib/auth/better-auth/secondary-storage';
import { redisManager } from '@lib/infra/redis';

jest.mock('@lib/infra/redis', () => ({
  redisManager: {
    get: jest.fn(),
    getAndDelete: jest.fn(),
    increment: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

const storage = createBetterAuthSecondaryStorage();

test('delegates single-use reads to atomic Redis consumption', async () => {
  jest.mocked(redisManager.getAndDelete).mockResolvedValue('token');
  await expect(storage.getAndDelete('verification')).resolves.toBe('token');
  expect(redisManager.getAndDelete).toHaveBeenCalledWith(
    'better-auth:secondary:verification'
  );
});

test('delegates rate counters to the fixed-window atomic increment', async () => {
  jest.mocked(redisManager.increment).mockResolvedValue(3);
  await expect(storage.increment('rate-limit', 60)).resolves.toBe(3);
  expect(redisManager.increment).toHaveBeenCalledWith(
    'better-auth:secondary:rate-limit',
    60
  );
});

test('preserves session writes and expiry', async () => {
  await storage.set('session', 'value', 120);
  expect(redisManager.set).toHaveBeenCalledWith(
    'better-auth:secondary:session',
    'value',
    { ttlSeconds: 120 }
  );
});

test('rejects blank keys before invoking atomic storage operations', async () => {
  await expect(storage.getAndDelete(' ')).rejects.toThrow(
    'key cannot be empty'
  );
  await expect(storage.increment(' ', 60)).rejects.toThrow(
    'key cannot be empty'
  );
  expect(redisManager.getAndDelete).not.toHaveBeenCalled();
  expect(redisManager.increment).not.toHaveBeenCalled();
});
