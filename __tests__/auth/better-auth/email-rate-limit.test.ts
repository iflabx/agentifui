/** @jest-environment node */
import { reserveAuthEmail } from '@lib/auth/better-auth/email-rate-limit';
import { redisManager } from '@lib/infra/redis';
import { createHash } from 'node:crypto';

jest.mock('@lib/infra/redis', () => ({
  redisManager: {
    getClient: jest.fn(),
    buildKey: (...parts: string[]) => `test:${parts.join(':')}`,
  },
}));

const evaluate = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (redisManager.getClient as jest.Mock).mockResolvedValue({ eval: evaluate });
  evaluate.mockResolvedValue(1);
});

test('reserves the cooldown and shared hourly quota in a single atomic script', async () => {
  await expect(
    reserveAuthEmail(' Person@Example.com ', 'verification')
  ).resolves.toBe(true);
  const digest = createHash('sha256')
    .update('person@example.com')
    .digest('hex');
  expect(evaluate).toHaveBeenCalledTimes(1);
  expect(evaluate).toHaveBeenCalledWith(expect.any(String), {
    keys: [
      `test:auth-email:{${digest}}:cooldown:verification`,
      `test:auth-email:{${digest}}:hour`,
    ],
    arguments: ['60', '3600', '5'],
  });
  expect(JSON.stringify(evaluate.mock.calls)).not.toContain(
    'person@example.com'
  );
});

test('normalizes case and spaces, shares the hourly key but separates purposes', async () => {
  await reserveAuthEmail(' Person@Example.com ', 'verification');
  await reserveAuthEmail('person@example.com', 'password-reset');
  const first = evaluate.mock.calls[0][1].keys;
  const second = evaluate.mock.calls[1][1].keys;
  expect(first[0]).not.toBe(second[0]);
  expect(first[1]).toBe(second[1]);
});

test('does not share quotas between different recipients', async () => {
  await reserveAuthEmail('first@example.com', 'verification');
  await reserveAuthEmail('second@example.com', 'verification');
  expect(evaluate.mock.calls[0][1].keys[1]).not.toBe(
    evaluate.mock.calls[1][1].keys[1]
  );
});

test('returns false without throwing when a quota is exhausted', async () => {
  evaluate.mockResolvedValue(0);
  await expect(
    reserveAuthEmail('person@example.com', 'verification')
  ).resolves.toBe(false);
});

test.each([null, '1', 2, -1])(
  'rejects invalid Redis result %s',
  async result => {
    evaluate.mockResolvedValue(result);
    await expect(
      reserveAuthEmail('person@example.com', 'verification')
    ).rejects.toThrow('invalid result');
  }
);

test('fails closed if Redis cannot be reached', async () => {
  (redisManager.getClient as jest.Mock).mockRejectedValue(
    new Error('Redis unavailable')
  );
  await expect(
    reserveAuthEmail('person@example.com', 'verification')
  ).rejects.toThrow('Redis unavailable');
  expect(evaluate).not.toHaveBeenCalled();
});

test('fails closed if the atomic operation fails', async () => {
  evaluate.mockRejectedValue(new Error('Redis command failed'));
  await expect(
    reserveAuthEmail('person@example.com', 'verification')
  ).rejects.toThrow('Redis command failed');
});

test('rejects an empty recipient before accessing Redis', async () => {
  await expect(reserveAuthEmail(' ', 'verification')).rejects.toThrow(
    'email address'
  );
  expect(redisManager.getClient).not.toHaveBeenCalled();
});
