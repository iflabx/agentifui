/** @jest-environment node */
import { ReadableStream } from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';

import { executeDifyWorkflow, streamDifyWorkflow } from './execution';
import { getDifyWorkflowRunDetail } from './query';

global.TextDecoder = TextDecoder as typeof global.TextDecoder;

jest.mock('./query', () => ({
  getDifyWorkflowRunDetail: jest.fn(),
}));

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

async function collectEvents<T>(
  stream: AsyncGenerator<T, void, undefined>
): Promise<T[]> {
  const events: T[] = [];

  for await (const event of stream) {
    events.push(event);
  }

  return events;
}

describe('streamDifyWorkflow', () => {
  const mockedGetDifyWorkflowRunDetail = jest.mocked(getDifyWorkflowRunDetail);

  beforeEach(() => {
    mockedGetDifyWorkflowRunDetail.mockReset();
    global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([false, true])(
    'settles completion and releases the body on consumer cancellation (started: %s)',
    async started => {
      const cancel = jest.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ event: 'node_started', data: { node_id: 'node-1' } })}\n\n`
            )
          );
        },
        cancel,
      });
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, body });
      const response = await streamDifyWorkflow(
        { inputs: {}, user: 'user-1', response_mode: 'streaming' },
        'app-1'
      );
      const completion = response.completionPromise.catch(error => error);
      if (started) await response.progressStream.next();
      await response.progressStream.return();

      const result = await Promise.race([
        completion,
        new Promise(resolve => setTimeout(() => resolve('pending'), 50)),
      ]);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe(
        'Workflow stream was closed before completion.'
      );
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
      expect(mockedGetDifyWorkflowRunDetail).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    }
  );

  it('recovers a terminal workflow result when the stream ends before workflow_finished', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'workflow_started',
          workflow_run_id: 'run-1',
          task_id: 'task-1',
          data: {
            id: 'run-1',
            workflow_id: 'wf-1',
            sequence_number: 1,
            created_at: 1,
          },
        },
        {
          event: 'node_started',
          workflow_run_id: 'run-1',
          task_id: 'task-1',
          data: {
            id: 'node-event-1',
            node_id: 'node-1',
            node_type: 'start',
            title: 'Start',
            index: 1,
            inputs: {},
            created_at: 2,
          },
        },
        {
          event: 'node_finished',
          workflow_run_id: 'run-1',
          task_id: 'task-1',
          data: {
            id: 'node-event-1',
            node_id: 'node-1',
            index: 1,
            inputs: {},
            outputs: { ok: true },
            status: 'succeeded',
            created_at: 3,
          },
        },
      ]),
    });

    mockedGetDifyWorkflowRunDetail.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: 'succeeded',
      inputs: '{}',
      outputs: { answer: 'done' },
      error: null,
      total_steps: 1,
      total_tokens: 5,
      created_at: 1,
      finished_at: 4,
      elapsed_time: 3,
    });

    const response = await streamDifyWorkflow(
      {
        inputs: { text: 'hello' },
        response_mode: 'streaming',
        user: 'user-1',
      },
      'app-1'
    );

    await expect(collectEvents(response.progressStream)).resolves.toHaveLength(
      2
    );
    await expect(response.completionPromise).resolves.toMatchObject({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: 'succeeded',
      outputs: { answer: 'done' },
    });
    expect(response.getWorkflowRunId()).toBe('run-1');
    expect(response.getTaskId()).toBe('task-1');
    expect(mockedGetDifyWorkflowRunDetail).toHaveBeenCalledWith(
      'app-1',
      'run-1'
    );
  });

  it('rejects when the stream ends early and no terminal workflow result can be recovered', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: createSseBody([
        {
          event: 'workflow_started',
          workflow_run_id: 'run-2',
          task_id: 'task-2',
          data: {
            id: 'run-2',
            workflow_id: 'wf-2',
            sequence_number: 1,
            created_at: 10,
          },
        },
      ]),
    });

    mockedGetDifyWorkflowRunDetail.mockResolvedValue({
      id: 'run-2',
      workflow_id: 'wf-2',
      status: 'running',
      inputs: '{}',
      outputs: null,
      error: null,
      total_steps: 1,
      total_tokens: 0,
      created_at: 10,
      finished_at: null,
      elapsed_time: null,
    });

    const response = await streamDifyWorkflow(
      {
        inputs: { text: 'hello' },
        response_mode: 'streaming',
        user: 'user-1',
      },
      'app-2'
    );

    await expect(collectEvents(response.progressStream)).rejects.toThrow(
      'Workflow stream ended before workflow_finished.'
    );
    await expect(response.completionPromise).rejects.toThrow(
      'Workflow stream ended before workflow_finished.'
    );
    expect(mockedGetDifyWorkflowRunDetail).toHaveBeenCalledTimes(3);
  });

  it('recovers a partial-success result without pretending it is full success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: createSseBody([
        {
          event: 'workflow_started',
          workflow_run_id: 'run-partial',
          task_id: 'task-partial',
          data: { id: 'run-partial' },
        },
      ]),
    });
    mockedGetDifyWorkflowRunDetail.mockResolvedValue({
      id: 'run-partial',
      workflow_id: 'workflow-1',
      status: 'partial-succeeded',
      inputs: { query: 'test' },
      outputs: { answer: 'partial' },
      error: null,
      total_steps: 2,
      total_tokens: 4,
      created_at: 1,
      finished_at: 3,
      elapsed_time: 2,
    });
    const response = await streamDifyWorkflow(
      { inputs: {}, user: 'user-1', response_mode: 'streaming' },
      'app-1'
    );
    const completion = expect(
      response.completionPromise
    ).resolves.toMatchObject({
      status: 'partial-succeeded',
      outputs: { answer: 'partial' },
    });
    await collectEvents(response.progressStream);
    await completion;
    expect(mockedGetDifyWorkflowRunDetail).toHaveBeenCalledTimes(1);
  });

  it('reports a paused workflow immediately rather than retrying it as a lost result', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: createSseBody([
        {
          event: 'workflow_paused',
          workflow_run_id: 'run-paused',
          task_id: 'task-paused',
          data: { status: 'paused', paused_nodes: ['human-input'] },
        },
      ]),
    });
    const response = await streamDifyWorkflow(
      { inputs: {}, user: 'user-1', response_mode: 'streaming' },
      'app-1'
    );
    const completion = expect(response.completionPromise).rejects.toThrow(
      'Human Input'
    );
    await expect(collectEvents(response.progressStream)).rejects.toThrow(
      'Human Input'
    );
    await completion;
    expect(mockedGetDifyWorkflowRunDetail).not.toHaveBeenCalled();
  });

  it('does not recover a paused run as a completed or failed upstream run', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: createSseBody([
        {
          event: 'workflow_started',
          workflow_run_id: 'run-paused',
          task_id: 'task-paused',
          data: { id: 'run-paused' },
        },
      ]),
    });
    mockedGetDifyWorkflowRunDetail.mockResolvedValue({
      id: 'run-paused',
      workflow_id: 'workflow-1',
      status: 'paused',
      inputs: {},
      outputs: {},
      error: null,
      total_steps: 1,
      total_tokens: 0,
      created_at: 1,
      finished_at: null,
      elapsed_time: 1,
    });
    const response = await streamDifyWorkflow(
      { inputs: {}, user: 'user-1', response_mode: 'streaming' },
      'app-1'
    );
    const completion = expect(response.completionPromise).rejects.toThrow(
      'Human Input'
    );
    await expect(collectEvents(response.progressStream)).rejects.toThrow(
      'Human Input'
    );
    await completion;
    expect(mockedGetDifyWorkflowRunDetail).toHaveBeenCalledTimes(1);
  });

  it('explicitly rejects a paused blocking response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        workflow_run_id: 'paused',
        task_id: 'task',
        data: { status: 'paused' },
      }),
    });
    await expect(
      executeDifyWorkflow(
        { inputs: {}, user: 'user-1', response_mode: 'blocking' },
        'app-1'
      )
    ).rejects.toThrow('Human Input');
  });

  it('preserves a deferred completion rejection without an unhandled promise', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: createSseBody([
        {
          event: 'workflow_paused',
          workflow_run_id: 'paused',
          data: { status: 'paused' },
        },
      ]),
    });
    const response = await streamDifyWorkflow(
      { inputs: {}, user: 'user-1', response_mode: 'streaming' },
      'app-1'
    );
    await expect(collectEvents(response.progressStream)).rejects.toThrow(
      'Human Input'
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    await expect(response.completionPromise).rejects.toThrow('Human Input');
  });

  it('does not manufacture timestamps or counters when recovering nullable details', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: createSseBody([
        {
          event: 'workflow_started',
          workflow_run_id: 'run-null',
          task_id: 'task',
          data: { id: 'run-null' },
        },
      ]),
    });
    mockedGetDifyWorkflowRunDetail.mockResolvedValue({
      id: 'run-null',
      workflow_id: 'workflow-1',
      status: 'stopped',
      inputs: null,
      outputs: {},
      error: null,
      total_steps: null,
      total_tokens: null,
      created_at: null,
      finished_at: null,
      elapsed_time: null,
    });
    const response = await streamDifyWorkflow(
      { inputs: {}, user: 'user-1', response_mode: 'streaming' },
      'app-1'
    );
    await collectEvents(response.progressStream);
    await expect(response.completionPromise).resolves.toMatchObject({
      status: 'stopped',
      total_steps: null,
      created_at: null,
      finished_at: null,
    });
  });
});
