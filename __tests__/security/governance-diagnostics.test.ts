/** @jest-environment node */
import { appendErrorEventMirror } from '../../apps/api/src/lib/error-event-mirror';
import { recordApiErrorEvent } from '../../apps/api/src/lib/error-events';
import { recordFrontendErrorEvent } from '../../apps/api/src/lib/frontend-error-events';
import { queryRowsWithPgSystemContext } from '../../apps/api/src/lib/pg-context';

const mockPublish = jest.fn().mockResolvedValue('1-0');
jest.mock('redis', () => ({
  createClient: () => ({ isOpen: true, on: jest.fn(), xAdd: mockPublish }),
}));
jest.mock('../../apps/api/src/lib/error-event-mirror', () => ({
  appendErrorEventMirror: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../apps/api/src/lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn().mockResolvedValue([]),
}));

const secret = 'synthetic-sensitive-value';
const input = {
  code: 'SAVE_FAILED',
  userMessage: `HTTP 503 at https://user:${secret}@example.invalid/reset-password/${secret}?token=${secret}`,
  developerMessage: `Bearer ${secret}\nCookie: session=${secret}`,
  requestId: 'safe-request-123',
  method: 'POST',
  route: `/login?token=${secret}`,
  context: {
    code: 'SAVE_FAILED',
    httpStatus: 503,
    href: secret,
    request: { password: secret },
    pathname: `/login?code=${secret}`,
  },
};

test('frontend persistence, mirror and Redis receive only safe diagnostics even when bypassing the browser', async () => {
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  await recordFrontendErrorEvent({
    ...input,
    severity: 'error',
    retryable: true,
  });
  const written = JSON.stringify([
    jest.mocked(queryRowsWithPgSystemContext).mock.calls,
    jest.mocked(appendErrorEventMirror).mock.calls,
    mockPublish.mock.calls,
  ]);
  expect(written).not.toContain(secret);
  expect(written).toContain('safe-request-123');
  expect(written).toContain('SAVE_FAILED');
});

test('API errors sanitize before fingerprinting, persistence and mirror', async () => {
  await recordApiErrorEvent({
    detail: {
      ...input,
      source: 'internal-data',
      severity: 'error',
      retryable: true,
      occurredAt: new Date().toISOString(),
    },
    method: input.method,
    route: input.route,
    statusCode: 503,
  });
  expect(
    JSON.stringify(jest.mocked(queryRowsWithPgSystemContext).mock.calls)
  ).not.toContain(secret);
  expect(jest.mocked(appendErrorEventMirror)).toHaveBeenCalledWith(
    expect.objectContaining({ route: '/login', requestId: 'safe-request-123' })
  );
});
