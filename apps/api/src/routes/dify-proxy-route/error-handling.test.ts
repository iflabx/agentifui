/** @jest-environment node */
import type { FastifyRequest } from 'fastify';

import { appendErrorEventMirror } from '../../lib/error-event-mirror';
import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import { logDifyProxyFailure, withAgentErrorEnvelope } from './error-handling';

jest.mock('../../lib/error-event-mirror', () => ({
  appendErrorEventMirror: jest.fn(),
}));
jest.mock('../../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
}));

const privateFixture = 'sensitive-upstream-fixture';
const rawMessage = `Unauthorized: ${privateFixture}`;
const context = {
  source: 'dify-chat' as const,
  status: 403,
  requestId: 'privacy-test-request',
  route: '/api/dify/app-1/chat-messages',
  method: 'POST',
  actorUserId: 'privacy-test-user',
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(appendErrorEventMirror).mockResolvedValue(undefined);
  jest.mocked(queryRowsWithPgSystemContext).mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

describe('Dify failure log privacy', () => {
  it.each(['warn', 'error'] as const)(
    'keeps structured %s diagnostics without response text or exception data',
    level => {
      const request = {
        id: context.requestId,
        method: context.method,
        log: { warn: jest.fn(), error: jest.fn() },
      } as unknown as FastifyRequest;
      const error = new Error(rawMessage, { cause: new Error(privateFixture) });
      error.stack = privateFixture;
      logDifyProxyFailure(request, {
        appId: 'app-1',
        routePath: context.route,
        slugPath: 'chat-messages',
        agentSource: context.source,
        failureKind: 'upstream-json-error',
        upstreamStatus: context.status,
        upstreamContentType: 'application/json',
        upstreamErrorCode: privateFixture,
        responseBody: rawMessage,
        elapsedMs: 42,
        level,
        error,
      });
      const details = jest.mocked(request.log[level]).mock.calls[0][0];
      expect(details).toMatchObject({
        requestId: context.requestId,
        upstreamStatus: 403,
        errorCode: 'AGENT_AUTH_FAILED',
        responseBytes: Buffer.byteLength(rawMessage),
        elapsedMs: 42,
      });
      expect(details).not.toHaveProperty('responsePreview');
      expect(details).not.toHaveProperty('err');
      expect(
        JSON.stringify(jest.mocked(request.log[level]).mock.calls)
      ).not.toContain(privateFixture);
    }
  );
});

describe('Dify error event privacy and response compatibility', () => {
  it.each(['AGENT_CONCURRENCY_LIMIT', 'AGENT_QUOTA_EXCEEDED'])(
    'keeps the governance code %s consistent in the Dify envelope',
    async code => {
      const response = await withAgentErrorEnvelope(
        { code, message: code },
        { ...context, status: 429 }
      );
      expect(response).toMatchObject({
        code,
        app_error: { code, retryable: code === 'AGENT_CONCURRENCY_LIMIT' },
      });
    }
  );
  it.each([
    ['JSON message', { code: privateFixture, message: rawMessage }],
    ['plain text', rawMessage],
    ['details', { details: rawMessage }],
    ['nested failure', { data: { status: 'failed', error: rawMessage } }],
  ])(
    'excludes %s text from database and mirror records',
    async (_label, payload) => {
      const response = await withAgentErrorEnvelope(payload, {
        ...context,
        extraContext: {
          upstream_message: privateFixture,
          moderation_categories: [privateFixture],
          agent_kind: privateFixture,
        },
      });
      await new Promise<void>(resolve => setImmediate(resolve));

      expect(response).toMatchObject({
        error: rawMessage,
        request_id: context.requestId,
        app_error: {
          code: 'AGENT_AUTH_FAILED',
          developerMessage: rawMessage,
          context: { upstream_message: privateFixture },
        },
        agent_error: { kind: 'auth_failed', rawMessage },
      });
      expect(appendErrorEventMirror).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'AGENT_AUTH_FAILED',
          developerMessage: null,
          httpStatus: 403,
          requestId: context.requestId,
          actorUserId: context.actorUserId,
          contextJson: expect.objectContaining({
            agent_source: 'dify-chat',
            agent_kind: 'auth_failed',
          }),
        })
      );
      expect(queryRowsWithPgSystemContext).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify(jest.mocked(appendErrorEventMirror).mock.calls)
      ).not.toContain(privateFixture);
      expect(
        JSON.stringify(jest.mocked(queryRowsWithPgSystemContext).mock.calls)
      ).not.toContain(privateFixture);
    }
  );

  it('does not echo persistence failures into console logs', async () => {
    const warning = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    jest
      .mocked(queryRowsWithPgSystemContext)
      .mockRejectedValueOnce(new Error(rawMessage));
    const response = await withAgentErrorEnvelope(rawMessage, context);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(response).toHaveProperty('error', rawMessage);
    expect(warning).toHaveBeenCalledWith(
      '[FastifyDifyProxy] failed to record error event',
      { requestId: context.requestId, code: 'AGENT_AUTH_FAILED' }
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain(privateFixture);
  });

  it('leaves successful payloads without errors untouched and unrecorded', async () => {
    const payload = { data: { answer: 'normal reply' } };
    expect(
      await withAgentErrorEnvelope(payload, { ...context, status: 200 })
    ).toBe(payload);
    expect(appendErrorEventMirror).not.toHaveBeenCalled();
    expect(queryRowsWithPgSystemContext).not.toHaveBeenCalled();
  });
});
