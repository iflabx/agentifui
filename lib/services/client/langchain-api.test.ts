/** @jest-environment node */
import {
  AgentRequestError,
  agentPath,
  agentRequest,
  consumeAgentStream,
} from './langchain-api';
import type { AgentEvent } from './langchain-api';

describe('agent client stream', () => {
  it('reads fragmented UTF-8 data events without persisting or generating requests', async () => {
    const bytes = new TextEncoder().encode(
      'data: {"type":"text","messageId":"one","delta":"你好"}\r\n\r\ndata: {"type":"status","executionStatus":"success","persistenceStatus":"saved"}\n\n'
    );
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      })
    );
    const events: AgentEvent[] = [];
    await consumeAgentStream(response, event => events.push(event));
    expect(events).toEqual([
      { type: 'text', messageId: 'one', delta: '你好' },
      {
        type: 'status',
        executionStatus: 'success',
        persistenceStatus: 'saved',
      },
    ]);
  });
  it('does not manufacture a success event on EOF', async () => {
    const events: AgentEvent[] = [];
    await consumeAgentStream(
      new Response(
        'data: {"type":"text","messageId":"one","delta":"partial"}\n\n'
      ),
      event => events.push(event)
    );
    expect(events.map(event => event.type)).toEqual(['text']);
  });
  it('rejects authentication errors and bounds incomplete frames', async () => {
    await expect(
      consumeAgentStream(new Response('', { status: 401 }), () => undefined)
    ).rejects.toBeInstanceOf(AgentRequestError);
    await expect(
      consumeAgentStream(new Response('x'.repeat(262145)), () => undefined)
    ).rejects.toThrow('frame too large');
    expect(agentPath('app/id', '/runs')).toBe(
      '/api/internal/apps/app%2Fid/agent/runs'
    );
  });
});

describe.each(['request', 'stream'] as const)('agent %s errors', operation => {
  afterEach(() => jest.restoreAllMocks());

  async function rejectResponse(response: Response) {
    if (operation === 'stream')
      return consumeAgentStream(response, () => undefined);
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(response);
    return agentRequest('synthetic-app', '');
  }

  it.each([
    [429, 'AGENT_QUOTA_EXCEEDED', false],
    [429, 'AGENT_CONCURRENCY_LIMIT', true],
    [400, 'CONTENT_MODERATION_BLOCKED', true],
    [503, 'CONTENT_MODERATION_UNAVAILABLE', true],
    [429, 'RATE_LIMITED', false],
  ] as const)(
    'retains the safe %s/%s error detail',
    async (status, code, retryable) => {
      const detail = {
        code,
        source: 'fastify-api',
        severity: 'warn',
        retryable,
        userMessage: 'A safe user-facing message',
        requestId: 'synthetic-request',
        occurredAt: '2026-01-01T00:00:00.000Z',
      };
      const failure = await rejectResponse(
        Response.json(
          {
            app_error: {
              ...detail,
              developerMessage: 'private debug value',
              context: { credential: 'private debug value' },
            },
          },
          { status }
        )
      ).catch(error => error);
      expect(failure).toBeInstanceOf(AgentRequestError);
      expect(failure).toHaveProperty('status', status);
      expect(failure).toHaveProperty('detail', detail);
    }
  );

  it.each(['<html>gateway failure</html>', '{', '[]', 'null'])(
    'falls back safely for a nonstandard error body: %s',
    async body => {
      await expect(
        rejectResponse(new Response(body, { status: 502 }))
      ).rejects.toMatchObject({ status: 502, detail: null });
    }
  );
});
