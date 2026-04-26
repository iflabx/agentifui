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
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
});
