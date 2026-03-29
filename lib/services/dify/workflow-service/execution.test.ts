/** @jest-environment node */
import { ReadableStream } from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';

import { streamDifyWorkflow } from './execution';
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
    global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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
});
