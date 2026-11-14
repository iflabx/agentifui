/** @jest-environment node */
import { executeAgentRun } from './agent-run-execution';
import type { AgentRunRecord } from './agent-runs-repository';
import { bindThread, saveRunResult } from './agent-runs-repository';
import {
  confirmSubmission,
  markSubmissionSubmitting,
  rejectSubmission,
} from './agent-submissions';
import { streamTurn } from './langchain/transport';

jest.mock('./agent-runs-repository', () => ({
  bindThread: jest.fn(),
  recordNativeRun: jest.fn(),
  recordRunPersistenceFailure: jest.fn(),
  markRunUnknown: jest.fn(),
  saveRunResult: jest.fn(),
}));
jest.mock('./agent-submissions', () => ({
  markSubmissionSubmitting: jest.fn().mockResolvedValue(undefined),
  confirmSubmission: jest.fn().mockResolvedValue(undefined),
  rejectSubmission: jest.fn().mockResolvedValue(undefined),
  rejectUnacceptedSubmission: jest.fn().mockResolvedValue(undefined),
}));

const app = {
  id: 'service',
  instanceId: 'agent',
  name: 'Example',
  baseUrl: 'https://agent.example',
  apiKey: 'synthetic-token',
  assistantId: 'agent',
  fingerprint: 'synthetic',
};
const initial = {
  id: 'local-run',
  conversation_id: 'conversation',
  user_message_id: 'user-message',
  thread_id: null,
  execution_status: 'reserved',
  persistence_status: 'pending',
} as AgentRunRecord;
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(bindThread)
    .mockResolvedValue({ ...initial, thread_id: 'thread' });
  jest.mocked(saveRunResult).mockImplementation(async (_, result) => ({
    ...initial,
    execution_status: result.executionStatus,
    persistence_status: 'saved',
  }));
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it.each([null, 'thread'])(
  'releases a known undispatched capabilities failure with thread=%s',
  async thread => {
    global.fetch = jest.fn(async url =>
      String(url).endsWith('/threads')
        ? Response.json({ thread_id: 'thread' })
        : new Response('{}', { status: 503 })
    );
    await executeAgentRun({
      rootTaskId: 'root',
      app,
      run: { ...initial, thread_id: thread },
      content: 'Hello',
      emit: jest.fn(),
      report: jest.fn(),
    });
    expect(
      jest
        .mocked(global.fetch)
        .mock.calls.filter(([url]) => String(url).endsWith('/ag-ui'))
    ).toHaveLength(0);
    expect(markSubmissionSubmitting).not.toHaveBeenCalled();
    expect(confirmSubmission).not.toHaveBeenCalled();
    expect(rejectSubmission).toHaveBeenCalledWith(
      'root',
      'AGENT_NOT_DISPATCHED'
    );
    expect(saveRunResult).toHaveBeenCalledWith(
      initial.id,
      expect.objectContaining({ executionStatus: 'error' })
    );
  }
);

it('releases a capabilities body timeout before generation dispatch', async () => {
  jest.useFakeTimers();
  const cancel = jest.fn();
  global.fetch = jest.fn().mockResolvedValue(
    new Response(new ReadableStream({ pull() {}, cancel }), {
      headers: { 'content-type': 'application/json' },
    })
  );
  const running = executeAgentRun({
    rootTaskId: 'root',
    app,
    run: { ...initial, thread_id: 'thread' },
    content: 'Hello',
    emit: jest.fn(),
    report: jest.fn(),
  });
  await jest.advanceTimersByTimeAsync(15001);
  await running;
  expect(cancel).toHaveBeenCalled();
  expect(markSubmissionSubmitting).not.toHaveBeenCalled();
  expect(rejectSubmission).toHaveBeenCalledWith('root', 'AGENT_NOT_DISPATCHED');
});

it('does not dispatch a mismatched assistant and preserves uncertainty after a dispatched POST disconnect', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(Response.json({ assistant_id: 'other' }));
  await executeAgentRun({
    rootTaskId: 'root',
    app,
    run: { ...initial, thread_id: 'thread' },
    content: 'Hello',
    emit: jest.fn(),
    report: jest.fn(),
  });
  expect(markSubmissionSubmitting).not.toHaveBeenCalled();
  expect(rejectSubmission).toHaveBeenCalledWith('root', 'AGENT_NOT_DISPATCHED');
  jest.clearAllMocks();
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(Response.json({ assistant_id: 'agent' }))
    .mockRejectedValueOnce(new Error('synthetic disconnect'));
  await executeAgentRun({
    rootTaskId: 'root',
    app,
    run: { ...initial, thread_id: 'thread' },
    content: 'Hello',
    emit: jest.fn(),
    report: jest.fn(),
  });
  expect(
    jest
      .mocked(global.fetch)
      .mock.calls.filter(([url]) => String(url).endsWith('/ag-ui'))
  ).toHaveLength(1);
  expect(markSubmissionSubmitting).toHaveBeenCalledTimes(1);
  expect(confirmSubmission).toHaveBeenLastCalledWith('root', 'unknown');
  expect(rejectSubmission).not.toHaveBeenCalled();
});

it('starts the stream deadline only after the governance claim returns, not while no request can have been sent', async () => {
  jest.useFakeTimers();
  let release: () => void = () => undefined;
  jest.mocked(markSubmissionSubmitting).mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        release = resolve;
      })
  );
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(Response.json({ assistant_id: 'agent' }))
    .mockImplementationOnce(async (_url, init) => {
      expect(init?.signal?.aborted).toBe(false);
      throw new Error('synthetic dispatched disconnect');
    });
  const running = executeAgentRun({
    rootTaskId: 'root',
    app,
    run: { ...initial, thread_id: 'thread' },
    content: 'Hello',
    emit: jest.fn(),
    report: jest.fn(),
  });
  await jest.advanceTimersByTimeAsync(150001);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  release();
  await running;
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(confirmSubmission).toHaveBeenLastCalledWith('root', 'unknown');
});

it('does not enter the dispatch phase if the signal aborts while a pre-dispatch claim is pending', async () => {
  const controller = new AbortController();
  const onDispatch = jest.fn();
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(Response.json({ assistant_id: 'agent' }));
  const consume = async () => {
    for await (const event of streamTurn(app, {
      threadId: 'thread',
      runId: initial.id,
      messageId: initial.user_message_id,
      content: 'Hello',
      signal: controller.signal,
      beforeDispatch: async () => {
        controller.abort();
      },
      onDispatch,
    }))
      void event;
  };
  await expect(consume()).rejects.toMatchObject({ code: 'UPSTREAM_ABORTED' });
  expect(onDispatch).not.toHaveBeenCalled();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
