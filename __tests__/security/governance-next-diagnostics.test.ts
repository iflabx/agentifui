/** @jest-environment node */
import { appendFile } from 'node:fs/promises';

import { appendErrorEventMirror as appendApiMirror } from '../../apps/api/src/lib/error-event-mirror';
import { appendErrorEventMirror as appendNextMirror } from '../../lib/server/errors/error-event-mirror';
import { recordErrorEvent } from '../../lib/server/errors/error-events';

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
const mockPublish = jest.fn().mockResolvedValue('1-0');
jest.mock('server-only', () => ({}));
jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../lib/server/pg/pool', () => ({
  getPgPool: () => ({ query: mockQuery }),
}));
jest.mock('../../lib/infra/redis/manager', () => ({
  getRedisManager: () => ({
    getClient: async () => ({ xAdd: mockPublish }),
    buildKey: (key: string) => key,
  }),
}));
const secret = 'synthetic-next-secret';
const input = {
  runtime: 'next' as const,
  fingerprint: 'safe-fingerprint',
  code: 'SAVE_FAILED',
  source: 'db' as const,
  severity: 'error' as const,
  retryable: true,
  userMessage: `Failed /reset-password/${secret}`,
  developerMessage: `https://example.invalid/login?token=${secret}`,
  requestId: 'safe-request',
  route: `/login?code=${secret}`,
  contextJson: { href: secret, code: 'SAVE_FAILED' },
};

test('Next persistence and Redis receive sanitized input', async () => {
  await recordErrorEvent({ ...input, context: input.contextJson });
  expect(
    JSON.stringify([
      mockQuery.mock.calls,
      mockPublish.mock.calls,
      jest.mocked(appendFile).mock.calls,
    ])
  ).not.toContain(secret);
  expect(mockQuery).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining(['safe-request', '/login'])
  );
});

test.each([appendNextMirror, appendApiMirror])(
  'direct mirror calls sanitize before serializing',
  async mirror => {
    await mirror(input);
    const serialized = jest.mocked(appendFile).mock.calls.at(-1)?.[1];
    expect(String(serialized)).not.toContain(secret);
    expect(JSON.parse(String(serialized))).toMatchObject({
      request_id: 'safe-request',
      route: '/login',
      context_json: { code: 'SAVE_FAILED' },
    });
  }
);
