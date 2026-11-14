/** @jest-environment node */
import {
  AgentRequestError,
  agentPath,
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
