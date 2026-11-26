import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import {
  normalizeCompletedAssistantReply,
  parseThinkBlocks,
} from '@lib/utils/think-parser';
import { ReadableStream } from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';

import { streamDifyChat } from './stream';

global.TextDecoder = TextDecoder as typeof global.TextDecoder;

function createSseBody(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = events
    .map(event => `data: ${JSON.stringify(event)}\n\n`)
    .join('');

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

async function collectStream(
  answerStream: AsyncGenerator<string, void, undefined>
): Promise<string> {
  let content = '';

  for await (const chunk of answerStream) {
    content += chunk;
  }

  return content;
}

describe('streamDifyChat agent_thought handling', () => {
  async function collectEvents(events: unknown[]) {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody(events),
    });
    const response = await streamDifyChat(
      { query: 'test', user: 'user-1', response_mode: 'streaming' },
      'app-1'
    );
    return collectStream(response.answerStream);
  }

  it('does not replay reasoning from an identical complete replacement snapshot', async () => {
    const answer = '<think>analysis</think>Answer';
    const content = await collectEvents([
      { event: 'message', answer },
      { event: 'message_replace', answer },
      { event: 'message_replace', answer },
      { event: 'message_end', metadata: {} },
    ]);
    expect(content).toBe(answer);
  });

  it('appends a replacement answer extension without repeating its reasoning', async () => {
    const content = await collectEvents([
      { event: 'message', answer: '<think>analysis</think>Answer' },
      {
        event: 'message_replace',
        answer: '<think>analysis</think>Answer continued',
      },
      { event: 'message_end', metadata: {} },
    ]);
    expect(content).toBe('<think>analysis</think>Answer continued');
  });

  it('discards a superseded partial tag before consuming later answer chunks', async () => {
    const content = await collectEvents([
      { event: 'message', answer: '<think>reason</thi' },
      { event: 'message_replace', answer: 'Done' },
      { event: 'message', answer: ' plus' },
      { event: 'message_end', metadata: {} },
    ]);
    expect(content).toBe('<think>reason</think>Done plus');
  });

  it('recovers a real closing tag after an unmatched inline backtick at completion', async () => {
    const answer = '<think>Consider the ` character.</think>Visible answer.';
    const content = await collectEvents([
      ...Array.from(answer, part => ({ event: 'message', answer: part })),
      { event: 'message_end', metadata: {} },
    ]);
    const normalized = normalizeCompletedAssistantReply(content, 'INCOMPLETE');
    expect(normalized.usedFallback).toBe(false);
    expect(
      parseThinkBlocks(normalized.content)
        .filter(block => block.type === 'text')
        .map(block => block.content)
        .join('')
        .trim()
    ).toBe('Visible answer.');
  });

  it.each([true, false])(
    'retains missing closure for completed answer recovery (message_end=%s)',
    withEnd => {
      const raw = '<think>Plan steps\n\n**最终回复**：\nThe visible answer.';
      return collectEvents([
        { event: 'message', answer: raw },
        ...(withEnd ? [{ event: 'message_end', metadata: {} }] : []),
      ]).then(content => {
        const normalized = normalizeCompletedAssistantReply(
          content,
          'INCOMPLETE'
        );
        expect(normalized.usedFallback).toBe(false);
        expect(
          parseThinkBlocks(normalized.content)
            .filter(block => block.type === 'text')
            .map(block => block.content)
            .join('')
            .trim()
        ).toBe('The visible answer.');
      });
    }
  );

  it.each([
    'Example:\n```xml\n<think>sample</think>\n```\nAnswer.',
    'Use `<think>sample</think>` literally.',
    'Example:\n~~~xml\n<think>sample</think>\n~~~\nAnswer.',
  ])(
    'preserves literal tags across every possible SSE chunk boundary: %s',
    async answer => {
      for (let split = 1; split < answer.length; split += 1) {
        const content = await collectEvents([
          { event: 'message', answer: answer.slice(0, split) },
          { event: 'message', answer: answer.slice(split) },
          { event: 'message_replace', answer },
          { event: 'message_end', metadata: {} },
        ]);
        expect(content).toBe(answer);
        expect(parseThinkBlocks(content)).toEqual([
          { type: 'text', content: answer },
        ]);
      }
    }
  );

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('forwards Chatflow lifecycle events in order around node events', async () => {
    const events = [
      { event: 'workflow_started', data: { id: 'run' } },
      { event: 'node_started', data: { node_id: 'node' } },
      {
        event: 'node_finished',
        data: { node_id: 'node', status: 'succeeded' },
      },
      { event: 'workflow_finished', data: { id: 'run', status: 'succeeded' } },
      { event: 'message', answer: 'Done' },
      { event: 'message_end', metadata: {} },
    ];
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: createSseBody(events),
    });
    const onNodeEvent = jest.fn();
    const response = await streamDifyChat(
      { query: 'hello', user: 'user-1', response_mode: 'streaming' },
      'app-1',
      undefined,
      onNodeEvent
    );
    expect(await collectStream(response.answerStream)).toBe('Done');
    expect(onNodeEvent.mock.calls.map(([event]) => event)).toEqual(
      events.slice(0, 4)
    );
  });

  it('finishes the real Chatflow tracker without erasing completed nodes', async () => {
    const store = useChatflowExecutionStore;
    store.getState().resetExecution();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: createSseBody([
        { event: 'workflow_started', data: { id: 'run' } },
        {
          event: 'node_started',
          data: { node_id: 'node', title: 'Answer', node_type: 'answer' },
        },
        { event: 'message', answer: 'Done' },
        {
          event: 'node_finished',
          data: { node_id: 'node', status: 'succeeded' },
        },
        {
          event: 'workflow_finished',
          data: { id: 'run', status: 'succeeded' },
        },
        { event: 'message_end', metadata: {} },
      ]),
    });
    try {
      const response = await streamDifyChat(
        { query: 'hello', user: 'user-1', response_mode: 'streaming' },
        'app-1',
        undefined,
        store.getState().handleNodeEvent
      );
      const first = await response.answerStream.next();
      expect(first.value).toBe('Done');
      expect(store.getState().isExecuting).toBe(true);
      await collectStream(response.answerStream);
      expect(store.getState().isExecuting).toBe(false);
      expect(store.getState().nodes).toEqual([
        expect.objectContaining({ id: 'node', status: 'completed' }),
      ]);
    } finally {
      store.getState().resetExecution();
    }
  });

  it.each([false, true])(
    'settles both promises and releases the body on consumer cancellation (started: %s)',
    async started => {
      const cancel = jest.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ event: 'message', answer: 'hello' })}\n\n`
            )
          );
        },
        cancel,
      });
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, body });
      const response = await streamDifyChat(
        { query: 'hello', user: 'user-1', response_mode: 'streaming' },
        'app-1'
      );
      const completion = response.completionPromise!.catch(error => error);
      if (started) await response.answerStream.next();
      await response.answerStream.return();

      const result = await Promise.race([
        completion,
        new Promise(resolve => setTimeout(() => resolve('pending'), 50)),
      ]);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe(
        'Chat stream was closed before completion.'
      );
      await expect(response.firstAnswerPromise).resolves.toBe(started);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    }
  );

  it('uses the official message_id from message_end for persistence', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: createSseBody([
        {
          event: 'message',
          conversation_id: 'conversation',
          task_id: 'task',
          message_id: 'official-id',
          answer: 'hello',
        },
        {
          event: 'message_end',
          conversation_id: 'conversation',
          task_id: 'task',
          message_id: 'official-id',
          id: 'legacy-id',
          metadata: { usage: { total_tokens: 3 } },
        },
      ]),
    });
    const response = await streamDifyChat(
      { query: 'hello', user: 'user-1', response_mode: 'streaming' },
      'app-1'
    );
    expect(await collectStream(response.answerStream)).toBe('hello');
    await expect(response.completionPromise).resolves.toMatchObject({
      messageId: 'official-id',
      usage: { total_tokens: 3 },
    });
  });

  it('does not silently succeed when a chatflow requires Human Input', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: createSseBody([
        {
          event: 'workflow_paused',
          conversation_id: 'conversation',
          task_id: 'task',
          workflow_run_id: 'run',
          data: { status: 'paused' },
        },
      ]),
    });
    const response = await streamDifyChat(
      { query: 'hello', user: 'user-1', response_mode: 'streaming' },
      'app-1'
    );
    const completion = expect(response.completionPromise).rejects.toThrow(
      'Human Input'
    );
    await expect(collectStream(response.answerStream)).rejects.toThrow(
      'Human Input'
    );
    await completion;
  });

  it('keeps a pause rejection observable when completion is awaited after stream failure', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: createSseBody([
        {
          event: 'workflow_paused',
          conversation_id: 'conversation',
          workflow_run_id: 'run',
          data: { status: 'paused' },
        },
      ]),
    });
    const response = await streamDifyChat(
      { query: 'test', user: 'user-1', response_mode: 'streaming' },
      'app-1'
    );
    await expect(collectStream(response.answerStream)).rejects.toThrow(
      'Human Input'
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    await expect(response.completionPromise).rejects.toThrow('Human Input');
  });

  it('should stream agent thoughts into a think block before the final answer', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'agent_thought',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'thought-1',
          message_id: 'msg-1',
          position: 1,
          thought: 'first step',
          observation: '',
          tool: '',
          tool_labels: {},
          tool_input: '',
          message_files: [],
          created_at: 1,
        },
        {
          event: 'agent_thought',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'thought-2',
          message_id: 'msg-1',
          position: 1,
          thought: 'first step refined',
          observation: '',
          tool: '',
          tool_labels: {},
          tool_input: '',
          message_files: [],
          created_at: 2,
        },
        {
          event: 'agent_message',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'answer-1',
          message_id: 'msg-1',
          answer: 'Final answer',
          created_at: 3,
        },
        {
          event: 'message_end',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'end-1',
          metadata: {},
          usage: {
            total_tokens: 10,
          },
        },
      ]),
    });

    const response = await streamDifyChat(
      {
        query: 'hello',
        user: 'user-1',
        response_mode: 'streaming',
      },
      'app-1'
    );

    await expect(collectStream(response.answerStream)).resolves.toBe(
      '<think>first step refined</think>Final answer'
    );
  });

  it('exposes the final Dify message id through completionPromise', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'message_file',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'preview-file-1',
          type: 'document',
          belongs_to: 'user',
          url: 'https://example.com/file-1',
        },
        {
          event: 'message',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'msg-1',
          answer: 'Final answer',
          created_at: 1,
        },
        {
          event: 'message_end',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'msg-1',
          metadata: {},
          usage: {
            total_tokens: 10,
          },
        },
      ]),
    });

    const response = await streamDifyChat(
      {
        query: 'hello',
        user: 'user-1',
        response_mode: 'streaming',
      },
      'app-1'
    );

    await collectStream(response.answerStream);

    await expect(response.completionPromise).resolves.toMatchObject({
      messageId: 'msg-1',
      userMessageFileIds: ['preview-file-1'],
      usage: {
        total_tokens: 10,
      },
    });
  });

  it('uses the upload file id from message_file events for persistence', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'message_file',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'message-file-record-1',
          upload_file_id: 'upload-file-1',
          type: 'document',
          belongs_to: 'user',
          url: 'https://example.com/file-1',
        },
        {
          event: 'message_end',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'message-1',
          metadata: {},
        },
      ]),
    });

    const response = await streamDifyChat(
      { query: 'hello', user: 'user-1', response_mode: 'streaming' },
      'app-1'
    );

    await collectStream(response.answerStream);

    await expect(response.completionPromise).resolves.toMatchObject({
      userMessageFileIds: ['upload-file-1'],
    });
  });

  it('should close a synthetic think block on message_end when no answer text arrives', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'agent_thought',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'thought-1',
          message_id: 'msg-1',
          position: 1,
          thought: 'standalone reasoning',
          observation: '',
          tool: '',
          tool_labels: {},
          tool_input: '',
          message_files: [],
          created_at: 1,
        },
        {
          event: 'message_end',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'end-1',
          metadata: {},
          usage: {
            total_tokens: 10,
          },
        },
      ]),
    });

    const response = await streamDifyChat(
      {
        query: 'hello',
        user: 'user-1',
        response_mode: 'streaming',
      },
      'app-1'
    );

    await expect(collectStream(response.answerStream)).resolves.toBe(
      '<think>standalone reasoning</think>'
    );
  });

  it('should append only the missing thought delta when the upstream stream already opened a think block', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'message',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'msg-raw-1',
          answer: '<think>first',
          created_at: 1,
        },
        {
          event: 'agent_thought',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'thought-1',
          message_id: 'msg-1',
          position: 1,
          thought: 'first second',
          observation: '',
          tool: '',
          tool_labels: {},
          tool_input: '',
          message_files: [],
          created_at: 2,
        },
        {
          event: 'message',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'msg-raw-2',
          answer: '</think>Done',
          created_at: 3,
        },
        {
          event: 'message_end',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'end-1',
          metadata: {},
          usage: {
            total_tokens: 10,
          },
        },
      ]),
    });

    const response = await streamDifyChat(
      {
        query: 'hello',
        user: 'user-1',
        response_mode: 'streaming',
      },
      'app-1'
    );

    await expect(collectStream(response.answerStream)).resolves.toBe(
      '<think>first second</think>Done'
    );
  });

  it('should recover a final answer from a mixed agent_thought payload after raw message think chunks', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'message',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'msg-raw-1',
          answer: '<think>用户',
          created_at: 1,
        },
        {
          event: 'message',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'msg-raw-2',
          answer: '想知道模型如何推理',
          created_at: 2,
        },
        {
          event: 'agent_thought',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'thought-1',
          message_id: 'msg-1',
          position: 1,
          thought: '<think>用户想知道模型如何推理</think>\n\n正式回答',
          observation: '',
          tool: '',
          tool_labels: {},
          tool_input: '',
          message_files: [],
          created_at: 3,
        },
        {
          event: 'message_end',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'end-1',
          metadata: {},
          usage: {
            total_tokens: 10,
          },
        },
      ]),
    });

    const response = await streamDifyChat(
      {
        query: 'hello',
        user: 'user-1',
        response_mode: 'streaming',
      },
      'app-1'
    );

    await expect(collectStream(response.answerStream)).resolves.toBe(
      '<think>用户想知道模型如何推理</think>正式回答'
    );
  });

  it('should ignore replayed agent_thought payloads after the answer has already been emitted', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'agent_thought',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'thought-1',
          message_id: 'msg-1',
          position: 1,
          thought: 'first step',
          observation: '',
          tool: '',
          tool_labels: {},
          tool_input: '',
          message_files: [],
          created_at: 1,
        },
        {
          event: 'agent_message',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'answer-1',
          message_id: 'msg-1',
          answer: 'Visible answer',
          created_at: 2,
        },
        {
          event: 'agent_thought',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'thought-2',
          message_id: 'msg-1',
          position: 2,
          thought: '<think>first step</think>Visible answer',
          observation: '',
          tool: '',
          tool_labels: {},
          tool_input: '',
          message_files: [],
          created_at: 3,
        },
        {
          event: 'message_end',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'end-1',
          metadata: {},
          usage: {
            total_tokens: 10,
          },
        },
      ]),
    });

    const response = await streamDifyChat(
      {
        query: 'hello',
        user: 'user-1',
        response_mode: 'streaming',
      },
      'app-1'
    );

    await expect(collectStream(response.answerStream)).resolves.toBe(
      '<think>first step</think>Visible answer'
    );
  });

  it('should keep the existing answer when a later mixed agent_thought payload conflicts', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'agent_thought',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'thought-1',
          message_id: 'msg-1',
          position: 1,
          thought: 'first step',
          observation: '',
          tool: '',
          tool_labels: {},
          tool_input: '',
          message_files: [],
          created_at: 1,
        },
        {
          event: 'agent_message',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'answer-1',
          message_id: 'msg-1',
          answer: 'Visible answer',
          created_at: 2,
        },
        {
          event: 'agent_thought',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'thought-2',
          message_id: 'msg-1',
          position: 2,
          thought: '<think>late conflicting reasoning</think>Another answer',
          observation: '',
          tool: '',
          tool_labels: {},
          tool_input: '',
          message_files: [],
          created_at: 3,
        },
        {
          event: 'message_end',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'end-1',
          metadata: {},
          usage: {
            total_tokens: 10,
          },
        },
      ]),
    });

    const response = await streamDifyChat(
      {
        query: 'hello',
        user: 'user-1',
        response_mode: 'streaming',
      },
      'app-1'
    );

    await expect(collectStream(response.answerStream)).resolves.toBe(
      '<think>first step</think>Visible answer'
    );
  });

  it('should unwrap an exact think-wrapped agent_thought payload once', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'agent_thought',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'thought-1',
          message_id: 'msg-1',
          position: 1,
          thought: '<think>wrapped reasoning</think>',
          observation: '',
          tool: '',
          tool_labels: {},
          tool_input: '',
          message_files: [],
          created_at: 1,
        },
        {
          event: 'message_end',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'end-1',
          metadata: {},
          usage: {
            total_tokens: 10,
          },
        },
      ]),
    });

    const response = await streamDifyChat(
      {
        query: 'hello',
        user: 'user-1',
        response_mode: 'streaming',
      },
      'app-1'
    );

    await expect(collectStream(response.answerStream)).resolves.toBe(
      '<think>wrapped reasoning</think>'
    );
  });

  it('should still allow a legitimate second thought segment after answer text', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'agent_thought',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'thought-1',
          message_id: 'msg-1',
          position: 1,
          thought: 'first step',
          observation: '',
          tool: '',
          tool_labels: {},
          tool_input: '',
          message_files: [],
          created_at: 1,
        },
        {
          event: 'agent_message',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'answer-1',
          message_id: 'msg-1',
          answer: 'Visible answer',
          created_at: 2,
        },
        {
          event: 'agent_thought',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'thought-2',
          message_id: 'msg-1',
          position: 2,
          thought: 'follow-up reasoning',
          observation: '',
          tool: '',
          tool_labels: {},
          tool_input: '',
          message_files: [],
          created_at: 3,
        },
        {
          event: 'agent_message',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'answer-2',
          message_id: 'msg-1',
          answer: 'Final answer',
          created_at: 4,
        },
        {
          event: 'message_end',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'end-1',
          metadata: {},
          usage: {
            total_tokens: 10,
          },
        },
      ]),
    });

    const response = await streamDifyChat(
      {
        query: 'hello',
        user: 'user-1',
        response_mode: 'streaming',
      },
      'app-1'
    );

    await expect(collectStream(response.answerStream)).resolves.toBe(
      '<think>first step</think>Visible answer<think>follow-up reasoning</think>Final answer'
    );
  });

  it('should append the final answer from message_replace instead of ignoring it', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'message',
          task_id: 'task-2',
          conversation_id: 'conv-2',
          id: 'msg-raw-1',
          answer: '<think>先分析用户的晚饭需求。\n\n',
          created_at: 1,
        },
        {
          event: 'message_replace',
          task_id: 'task-2',
          conversation_id: 'conv-2',
          id: 'replace-1',
          answer: '今晚可以去二食堂试试小火锅。',
          created_at: 2,
        },
        {
          event: 'message_end',
          task_id: 'task-2',
          conversation_id: 'conv-2',
          id: 'end-2',
          metadata: {},
          usage: {
            total_tokens: 10,
          },
        },
      ]),
    });

    const response = await streamDifyChat(
      {
        query: 'hello',
        user: 'user-1',
        response_mode: 'streaming',
      },
      'app-1'
    );

    await expect(collectStream(response.answerStream)).resolves.toBe(
      '<think>先分析用户的晚饭需求。\n\n</think>今晚可以去二食堂试试小火锅。'
    );
  });

  it('resolves firstAnswerPromise true after first answer chunk', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'agent_message',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'answer-1',
          message_id: 'msg-1',
          answer: 'Final answer',
          created_at: 1,
        },
        {
          event: 'message_end',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'end-1',
          metadata: {},
        },
      ]),
    });

    const response = await streamDifyChat(
      {
        query: 'hello',
        user: 'user-1',
        response_mode: 'streaming',
      },
      'app-1'
    );

    await collectStream(response.answerStream);
    await expect(response.firstAnswerPromise).resolves.toBe(true);
  });

  it('resolves firstAnswerPromise false when stream ends without answer', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'agent_thought',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'thought-1',
          message_id: 'msg-1',
          position: 1,
          thought: 'thinking only',
          observation: '',
          tool: '',
          tool_labels: {},
          tool_input: '',
          message_files: [],
          created_at: 1,
        },
        {
          event: 'message_end',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          id: 'end-1',
          metadata: {},
        },
      ]),
    });

    const response = await streamDifyChat(
      {
        query: 'hello',
        user: 'user-1',
        response_mode: 'streaming',
      },
      'app-1'
    );

    await collectStream(response.answerStream);
    await expect(response.firstAnswerPromise).resolves.toBe(false);
  });
});
