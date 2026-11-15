/** @jest-environment node */
import { parseAgentEvent } from '@agentifui/shared';

import type { AgentApp } from './agent-app';
import { executeAgentRun, publicAgentRun } from './agent-run-execution';
import {
  type AgentRunRecord,
  bindThread,
  loadRunDisplayHistory,
  markRunUnknown,
  recordNativeRun,
  recordRunPersistenceFailure,
  saveRunResult,
} from './agent-runs-repository';
import {
  confirmSubmission,
  markSubmissionSubmitting,
  rejectSubmission,
  rejectUnacceptedSubmission,
} from './agent-submissions';
import {
  type AGUIEvent,
  LangChainUpstreamError,
  createThread,
  streamTurn,
} from './langchain/transport';

jest.mock('./agent-runs-repository', () => ({
  ...jest.requireActual('./agent-runs-repository'),
  bindThread: jest.fn(),
  loadRunDisplayHistory: jest.fn(),
  markRunUnknown: jest.fn(),
  recordNativeRun: jest.fn(),
  recordRunPersistenceFailure: jest.fn().mockResolvedValue(undefined),
  saveRunResult: jest.fn(),
}));
jest.mock('./agent-submissions', () => ({
  confirmSubmission: jest.fn().mockResolvedValue(undefined),
  markSubmissionSubmitting: jest.fn().mockResolvedValue(undefined),
  rejectSubmission: jest.fn().mockResolvedValue(undefined),
  rejectUnacceptedSubmission: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./langchain/transport', () => ({
  ...jest.requireActual('./langchain/transport'),
  createThread: jest.fn(),
  streamTurn: jest.fn(),
}));

const app: AgentApp = {
  id: 'service',
  instanceId: 'agent',
  name: 'Example',
  baseUrl: 'https://agent.example',
  apiKey: 'synthetic-token',
  assistantId: 'agent',
  fingerprint: 'synthetic-fingerprint',
};
const initial = {
  id: 'local-run',
  conversation_id: 'local-conversation',
  user_message_id: 'user-message',
  thread_id: null,
  execution_status: 'reserved',
  persistence_status: 'pending',
  native_run_id: null,
  config_fingerprint: 'private-fingerprint',
  result: null,
  error_code: null,
} as AgentRunRecord;

function stream(events: AGUIEvent[], error?: Error) {
  jest.mocked(streamTurn).mockImplementation(async function* (_app, turn) {
    await turn.beforeDispatch?.();
    turn.onDispatch?.();
    yield* events;
    if (error) throw error;
  });
}

const textEvents: AGUIEvent[] = [
  { type: 'CUSTOM', name: 'native_run', value: { run_id: 'native-run' } },
  {
    type: 'TEXT_MESSAGE_START',
    messageId: 'upstream-message',
    role: 'assistant',
  },
  {
    type: 'TEXT_MESSAGE_CONTENT',
    messageId: 'upstream-message',
    delta: 'Example response',
  },
  { type: 'TEXT_MESSAGE_END', messageId: 'upstream-message' },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createThread).mockResolvedValue({ threadId: 'native-thread' });
  jest.mocked(bindThread).mockResolvedValue({
    ...initial,
    thread_id: 'native-thread',
    execution_status: 'submitting',
  });
  jest.mocked(recordNativeRun).mockResolvedValue({
    ...initial,
    thread_id: 'native-thread',
    native_run_id: 'native-run',
    execution_status: 'running',
  });
  jest
    .mocked(markRunUnknown)
    .mockResolvedValue({ ...initial, execution_status: 'unknown' });
  jest.mocked(saveRunResult).mockImplementation(async (_, result) => ({
    ...initial,
    execution_status: result.executionStatus,
    persistence_status: 'saved',
    error_code: result.errorCode || null,
  }));
  stream([
    ...textEvents,
    { type: 'RUN_FINISHED', threadId: 'native-thread', runId: initial.id },
  ]);
  jest
    .mocked(loadRunDisplayHistory)
    .mockResolvedValue([
      { id: initial.user_message_id, role: 'user', content: 'one new input' },
    ]);
});

async function runAgui() {
  const events: unknown[] = [];
  const legacy = jest.fn();
  await executeAgentRun({
    rootTaskId: 'root-task',
    app,
    run: { ...initial, submission_id: 'submission' },
    content: 'one new input',
    emit: legacy,
    agui: { emit: event => events.push(event) },
    report: jest.fn(),
  });
  return {
    events,
    legacy,
    result: jest.mocked(saveRunResult).mock.calls[0][1],
  };
}

describe('negotiated AG-UI runtime', () => {
  it('uses the existing governed dispatch and persists a scoped public projection', async () => {
    jest.mocked(loadRunDisplayHistory).mockResolvedValue([
      { id: 'prior-user', role: 'user', content: 'earlier question' },
      { id: 'prior-answer', role: 'assistant', content: 'earlier answer' },
      { id: initial.user_message_id, role: 'user', content: 'one new input' },
    ]);
    const { events, legacy, result } = await runAgui();
    expect(events[0]).toMatchObject({
      type: 'RUN_STARTED',
      protocolVersion: '1.0',
      threadId: initial.conversation_id,
      runId: initial.id,
      metadata: { 'agentifui.acceptance.v1': { submissionId: 'submission' } },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'RUN_FINISHED',
      outcome: { type: 'success' },
    });
    for (const event of events) expect(parseAgentEvent(event)).toBeDefined();
    expect(legacy).not.toHaveBeenCalled();
    expect(streamTurn).toHaveBeenCalledTimes(1);
    expect(jest.mocked(streamTurn).mock.calls[0][1]).toMatchObject({
      content: 'one new input',
    });
    expect(jest.mocked(streamTurn).mock.calls[0][1]).not.toHaveProperty(
      'history'
    );
    expect(result.agui).toMatchObject({
      schemaVersion: 2,
      status: 'succeeded',
      outputMessageIds: [result.messages[0].id],
    });
    expect(result.agui?.messages.map(message => message.id)).toEqual([
      'prior-user',
      'prior-answer',
      initial.user_message_id,
      result.messages[0].id,
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /native-thread|native-run|private-fingerprint|synthetic-token/
    );
    expect(confirmSubmission).toHaveBeenCalledWith('root-task', 'finished');
  });

  it('does not emit persistence status or a second terminal after saving fails', async () => {
    jest
      .mocked(saveRunResult)
      .mockRejectedValue(new Error('synthetic storage outage'));
    const { events, result } = await runAgui();
    expect(events.at(-1)).toMatchObject({
      type: 'RUN_FINISHED',
      outcome: { type: 'success' },
    });
    expect(result.executionStatus).toBe('success');
    expect(recordRunPersistenceFailure).toHaveBeenCalledWith(
      initial.id,
      result
    );
    expect(saveRunResult).toHaveBeenCalledTimes(2);
    expect(jest.mocked(saveRunResult).mock.calls[1][1]).toEqual(result);
    expect(
      events.filter(
        event => (event as { type: string }).type === 'RUN_FINISHED'
      )
    ).toHaveLength(1);
    expect(streamTurn).toHaveBeenCalledTimes(1);
    expect(markRunUnknown).not.toHaveBeenCalled();
  });

  it('retains unknown and partial output on native truncation without rerunning', async () => {
    stream(textEvents, new LangChainUpstreamError('UPSTREAM_INCOMPLETE'));
    const { events, result } = await runAgui();
    expect(events.at(-1)).toMatchObject({
      type: 'RUN_ERROR',
      code: 'AGENT_STREAM_INCOMPLETE',
    });
    expect(result).toMatchObject({
      executionStatus: 'unknown',
      agui: { status: 'unknown' },
      messages: [{ content: 'Example response' }],
    });
    expect(streamTurn).toHaveBeenCalledTimes(1);
    expect(confirmSubmission).toHaveBeenCalledWith('root-task', 'unknown');
  });

  it('refuses to execute without a complete trusted history and releases admission', async () => {
    jest
      .mocked(loadRunDisplayHistory)
      .mockRejectedValue(new Error('synthetic missing history'));
    const { events, result } = await runAgui();
    expect(events).toEqual([
      {
        type: 'RUN_ERROR',
        code: 'AGENT_RUN_FAILED',
        message: 'Agent execution failed.',
      },
    ]);
    expect(createThread).not.toHaveBeenCalled();
    expect(streamTurn).not.toHaveBeenCalled();
    expect(rejectSubmission).toHaveBeenCalledWith(
      'root-task',
      'AGENT_NOT_DISPATCHED'
    );
    expect(result.executionStatus).toBe('error');
  });

  it('persists tool-only activity without fabricating an assistant message', async () => {
    stream([
      { type: 'CUSTOM', name: 'native_run', value: { run_id: 'native-run' } },
      {
        type: 'TOOL_CALL_START',
        toolCallId: 'private-tool',
        toolCallName: 'search',
      },
      {
        type: 'TOOL_CALL_RESULT',
        toolCallId: 'private-tool',
        messageId: 'private-result',
        role: 'tool',
        content: 'private-debug-result',
      },
      { type: 'RUN_FINISHED', threadId: 'native-thread', runId: initial.id },
    ]);
    const { events, result } = await runAgui();
    expect(result.messages).toEqual([]);
    expect(result.agui?.messages).toHaveLength(2);
    expect(result.agui?.messages[1]).toMatchObject({
      role: 'activity',
      content: { name: 'search', status: 'completed' },
    });
    expect(result.agui?.outputMessageIds).toEqual([
      result.agui?.messages[1].id,
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /private-tool|private-result|private-debug-result/
    );
  });

  it('materializes only projected partial text when a delta exceeds the complete-view budget', async () => {
    jest.mocked(loadRunDisplayHistory).mockResolvedValue([
      {
        id: 'large-prior-answer',
        role: 'assistant',
        content: 'x'.repeat(500000),
      },
      { id: initial.user_message_id, role: 'user', content: 'one new input' },
    ]);
    stream([
      ...textEvents,
      { type: 'TEXT_MESSAGE_START', messageId: 'too-large', role: 'assistant' },
      {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'too-large',
        delta: 'x'.repeat(30000),
      },
    ]);
    const { result, events } = await runAgui();
    expect(result.executionStatus).toBe('unknown');
    const snapshotMessages = result.agui!.messages.filter(
      message =>
        result.agui!.outputMessageIds.includes(message.id) &&
        message.role === 'assistant'
    );
    expect(
      result.messages.map(message => [message.id, message.content])
    ).toEqual(snapshotMessages.map(message => [message.id, message.content]));
    expect(result.messages.map(message => message.content)).toEqual([
      'Example response',
      '',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'RUN_ERROR',
      code: 'AGENT_STREAM_INCOMPLETE',
    });
    expect(streamTurn).toHaveBeenCalledTimes(1);
  });
});

async function run(
  overrides: Partial<AgentRunRecord> = {},
  rootTaskId?: string
) {
  const events: unknown[] = [];
  const report = jest.fn();
  await executeAgentRun({
    rootTaskId,
    app,
    run: { ...initial, ...overrides },
    content: 'one new input',
    emit: event => events.push(event),
    report,
  });
  return { events, report };
}

it('creates and binds a thread before one new user input, saves only current-run content', async () => {
  const { events } = await run();
  expect(bindThread).toHaveBeenCalledWith(initial.id, 'native-thread');
  expect(streamTurn).toHaveBeenCalledWith(app, {
    threadId: 'native-thread',
    runId: initial.id,
    messageId: initial.user_message_id,
    content: 'one new input',
    beforeDispatch: expect.any(Function),
    onDispatch: expect.any(Function),
  });
  expect(recordNativeRun).toHaveBeenCalledWith(initial.id, 'native-run');
  const result = jest.mocked(saveRunResult).mock.calls[0][1];
  expect(result.executionStatus).toBe('success');
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0].id).toMatch(/^[a-f\d-]{36}$/);
  expect(result.messages[0].content).toBe('Example response');
  expect(events.at(-1)).toMatchObject({
    type: 'status',
    executionStatus: 'success',
    persistenceStatus: 'saved',
  });
  expect(JSON.stringify(events)).not.toContain('native-run');
});

it('durably claims a governed turn before dispatch and confirms usage before forwarding events', async () => {
  await run({}, 'root-task');
  expect(markSubmissionSubmitting).toHaveBeenCalledWith('root-task');
  expect(confirmSubmission).toHaveBeenNthCalledWith(1, 'root-task', 'accepted');
  expect(confirmSubmission).toHaveBeenNthCalledWith(2, 'root-task', 'finished');
  expect(
    jest.mocked(markSubmissionSubmitting).mock.invocationCallOrder[0]
  ).toBeLessThan(jest.mocked(confirmSubmission).mock.invocationCallOrder[0]);
});

it('does not confuse save-only failure with uncertain execution or dispatch a second turn', async () => {
  jest
    .mocked(saveRunResult)
    .mockRejectedValue(new Error('synthetic save failure'));
  const { events } = await run({}, 'root-task');
  expect(confirmSubmission).toHaveBeenLastCalledWith('root-task', 'finished');
  expect(recordRunPersistenceFailure).toHaveBeenCalledWith(
    initial.id,
    expect.objectContaining({ executionStatus: 'success' })
  );
  expect(markRunUnknown).not.toHaveBeenCalled();
  expect(streamTurn).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'failed',
  });
});

it('saves known successful text even when governance finalization fails and never regenerates', async () => {
  jest
    .mocked(confirmSubmission)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('synthetic governance failure'));
  const { events, report } = await run({}, 'root-task');
  expect(confirmSubmission).toHaveBeenLastCalledWith('root-task', 'unknown');
  expect(saveRunResult).toHaveBeenCalledWith(
    initial.id,
    expect.objectContaining({
      executionStatus: 'success',
      messages: [expect.objectContaining({ content: 'Example response' })],
    })
  );
  expect(report).toHaveBeenCalledWith({
    runId: initial.id,
    code: 'AGENT_GOVERNANCE_UNAVAILABLE',
  });
  expect(streamTurn).toHaveBeenCalledTimes(1);
  expect(createThread).toHaveBeenCalledTimes(1);
  expect(markRunUnknown).not.toHaveBeenCalled();
  expect(events.at(-1)).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'saved',
  });
});

it('records the same known snapshot when both governance recovery and message saving fail', async () => {
  jest
    .mocked(confirmSubmission)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('synthetic governance failure'))
    .mockRejectedValueOnce(new Error('synthetic unknown write failure'));
  jest
    .mocked(saveRunResult)
    .mockRejectedValueOnce(new Error('synthetic save failure'))
    .mockRejectedValueOnce(new Error('synthetic retry failure'));
  const { events } = await run({}, 'root-task');
  const snapshot = jest.mocked(saveRunResult).mock.calls[0][1];
  expect(snapshot).toMatchObject({
    executionStatus: 'success',
    messages: [{ content: 'Example response' }],
  });
  expect(saveRunResult).toHaveBeenNthCalledWith(2, initial.id, snapshot);
  expect(recordRunPersistenceFailure).toHaveBeenCalledWith(
    initial.id,
    snapshot
  );
  expect(markRunUnknown).not.toHaveBeenCalled();
  expect(streamTurn).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'failed',
  });
});

it('keeps ambiguous execution unknown and retains its partial text when governance writes fail', async () => {
  stream(textEvents, new LangChainUpstreamError('UPSTREAM_INCOMPLETE'));
  jest
    .mocked(confirmSubmission)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('synthetic unknown failure'))
    .mockRejectedValueOnce(new Error('synthetic unknown retry failure'));
  const { events } = await run({}, 'root-task');
  expect(confirmSubmission).toHaveBeenNthCalledWith(2, 'root-task', 'unknown');
  expect(confirmSubmission).toHaveBeenLastCalledWith('root-task', 'unknown');
  expect(rejectSubmission).not.toHaveBeenCalled();
  expect(rejectUnacceptedSubmission).not.toHaveBeenCalled();
  expect(saveRunResult).toHaveBeenCalledWith(
    initial.id,
    expect.objectContaining({
      executionStatus: 'unknown',
      messages: [expect.objectContaining({ content: 'Example response' })],
    })
  );
  expect(streamTurn).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toMatchObject({
    executionStatus: 'unknown',
    persistenceStatus: 'saved',
  });
});

it.each(['setup', 'native refusal'])(
  'saves the known failure even if governance rejection fails after %s',
  async stage => {
    if (stage === 'setup') {
      jest
        .mocked(createThread)
        .mockRejectedValueOnce(new Error('synthetic setup failure'));
      jest
        .mocked(rejectSubmission)
        .mockRejectedValueOnce(new Error('synthetic rejection failure'));
    } else {
      stream([], new LangChainUpstreamError('UPSTREAM_HTTP_ERROR', 403));
      jest
        .mocked(rejectUnacceptedSubmission)
        .mockRejectedValueOnce(new Error('synthetic rejection failure'));
    }
    const { events } = await run({}, 'root-task');
    expect(confirmSubmission).toHaveBeenLastCalledWith('root-task', 'unknown');
    expect(saveRunResult).toHaveBeenCalledWith(
      initial.id,
      expect.objectContaining({ executionStatus: 'error', messages: [] })
    );
    expect(streamTurn).toHaveBeenCalledTimes(stage === 'setup' ? 0 : 1);
    expect(events.at(-1)).toMatchObject({
      executionStatus: 'error',
      persistenceStatus: 'saved',
    });
  }
);

it('releases known pre-dispatch setup failure but retains ambiguous dispatched usage', async () => {
  jest
    .mocked(createThread)
    .mockRejectedValueOnce(new Error('synthetic setup failure'));
  await run({}, 'root-task');
  expect(rejectSubmission).toHaveBeenCalledWith(
    'root-task',
    'AGENT_NOT_DISPATCHED'
  );
  expect(streamTurn).not.toHaveBeenCalled();
  expect(saveRunResult).toHaveBeenCalledWith(
    initial.id,
    expect.objectContaining({ executionStatus: 'error', messages: [] })
  );
  jest.clearAllMocks();
  stream([], new LangChainUpstreamError('UPSTREAM_INCOMPLETE'));
  await run({ thread_id: 'native-thread' }, 'second-root');
  expect(confirmSubmission).toHaveBeenCalledWith('second-root', 'unknown');
  expect(rejectSubmission).not.toHaveBeenCalled();
  expect(saveRunResult).toHaveBeenCalledWith(
    initial.id,
    expect.objectContaining({ executionStatus: 'unknown' })
  );
});

it('releases a completed claim when transport aborts before dispatch without recording uncertainty', async () => {
  jest.mocked(streamTurn).mockImplementationOnce(async function* (_app, turn) {
    await turn.beforeDispatch?.();
    throw new DOMException('Synthetic pre-dispatch abort', 'AbortError');
  });
  const { events } = await run({}, 'root-task');
  expect(markSubmissionSubmitting).toHaveBeenCalledWith('root-task');
  expect(rejectUnacceptedSubmission).toHaveBeenCalledWith(
    'root-task',
    'AGENT_NOT_DISPATCHED'
  );
  expect(rejectSubmission).not.toHaveBeenCalled();
  expect(confirmSubmission).not.toHaveBeenCalled();
  expect(markRunUnknown).not.toHaveBeenCalled();
  expect(events.at(-1)).toMatchObject({
    executionStatus: 'error',
    persistenceStatus: 'saved',
  });
});

it.each(['thread', 'binding', 'claim'])(
  'does not retain an active run after an undispatched %s failure',
  async stage => {
    if (stage === 'thread')
      jest
        .mocked(createThread)
        .mockRejectedValueOnce(new LangChainUpstreamError('UPSTREAM_TIMEOUT'));
    if (stage === 'binding')
      jest
        .mocked(bindThread)
        .mockRejectedValueOnce(new Error('synthetic binding failure'))
        .mockRejectedValueOnce(new Error('synthetic binding failure'));
    if (stage === 'claim')
      jest
        .mocked(markSubmissionSubmitting)
        .mockRejectedValueOnce(new Error('synthetic claim failure'));
    const { events } = await run({}, 'root-task');
    if (stage !== 'claim') expect(streamTurn).not.toHaveBeenCalled();
    expect(confirmSubmission).not.toHaveBeenCalled();
    expect(rejectSubmission).toHaveBeenCalledWith(
      'root-task',
      'AGENT_NOT_DISPATCHED'
    );
    expect(saveRunResult).toHaveBeenCalledWith(
      initial.id,
      expect.objectContaining({ executionStatus: 'error', messages: [] })
    );
    expect(events.at(-1)).toMatchObject({
      executionStatus: 'error',
      persistenceStatus: 'saved',
    });
  }
);

it.each([undefined, 'root-task'])(
  'preserves undispatched execution failure when saving fails with root %s',
  async rootTaskId => {
    jest
      .mocked(createThread)
      .mockRejectedValueOnce(new Error('synthetic setup failure'));
    jest
      .mocked(saveRunResult)
      .mockRejectedValueOnce(new Error('synthetic save failure'))
      .mockRejectedValueOnce(new Error('synthetic save failure'));
    const { events } = await run({}, rootTaskId);
    expect(recordRunPersistenceFailure).toHaveBeenCalledWith(
      initial.id,
      expect.objectContaining({ executionStatus: 'error', messages: [] })
    );
    expect(markRunUnknown).not.toHaveBeenCalled();
    expect(streamTurn).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      executionStatus: 'error',
      persistenceStatus: 'failed',
    });
  }
);

it.each([400, 401, 403, 404, 405, 413, 415, 422])(
  'releases explicit pre-acceptance HTTP %s without charging or leaving unknown quota',
  async status => {
    stream([], new LangChainUpstreamError('UPSTREAM_HTTP_ERROR', status));
    await run({}, 'root-task');
    expect(rejectUnacceptedSubmission).toHaveBeenCalledWith('root-task');
    expect(confirmSubmission).not.toHaveBeenCalled();
    expect(saveRunResult).toHaveBeenCalledWith(
      initial.id,
      expect.objectContaining({ executionStatus: 'error' })
    );
  }
);

it.each([429, 500, 503])(
  'retains unknown after ambiguous HTTP %s instead of assuming refusal',
  async status => {
    stream([], new LangChainUpstreamError('UPSTREAM_HTTP_ERROR', status));
    await run({}, 'root-task');
    expect(rejectUnacceptedSubmission).not.toHaveBeenCalled();
    expect(confirmSubmission).toHaveBeenCalledWith('root-task', 'unknown');
  }
);

it('reuses the trusted thread instead of creating one for continuation', async () => {
  await run({ thread_id: 'native-thread' });
  expect(createThread).not.toHaveBeenCalled();
  expect(streamTurn).toHaveBeenCalledTimes(1);
});

it('does not interpret text end or premature EOF as execution success', async () => {
  stream(textEvents, new LangChainUpstreamError('UPSTREAM_INCOMPLETE'));
  const { events } = await run();
  expect(events.at(-1)).toMatchObject({
    executionStatus: 'unknown',
    persistenceStatus: 'saved',
    errorCode: 'UPSTREAM_INCOMPLETE',
  });
  expect(streamTurn).toHaveBeenCalledTimes(1);
});

it('keeps partial content when the upstream reports an explicit terminal error', async () => {
  stream([
    ...textEvents,
    {
      type: 'RUN_ERROR',
      code: 'MODEL_TIMEOUT',
      message: 'The model request timed out.',
    },
  ]);
  const { events } = await run();
  expect(events.at(-1)).toMatchObject({
    executionStatus: 'error',
    errorCode: 'MODEL_TIMEOUT',
  });
  expect(jest.mocked(saveRunResult).mock.calls[0][1].messages[0].content).toBe(
    'Example response'
  );
});

it.each(['RUN_INCOMPLETE', 'AGENT_STREAM_FAILED'])(
  'keeps uncertain upstream %s outcomes unknown',
  async code => {
    stream([...textEvents, { type: 'RUN_ERROR', code, message: 'Safe error' }]);
    const { events } = await run();
    expect(events.at(-1)).toMatchObject({
      executionStatus: 'unknown',
      persistenceStatus: 'saved',
      errorCode: code,
    });
  }
);

it('bounds partial messages before exceeding the persistence snapshot limit', async () => {
  const events: AGUIEvent[] = [
    { type: 'CUSTOM', name: 'native_run', value: { run_id: 'native-run' } },
  ];
  for (let index = 0; index < 65; index += 1) {
    events.push({
      type: 'TEXT_MESSAGE_START',
      messageId: `message-${index}`,
      role: 'assistant',
    });
    events.push({
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: `message-${index}`,
      delta: '\u0000'.repeat(1000),
    });
  }
  stream(events);
  const result = await run();
  const snapshot = jest.mocked(saveRunResult).mock.calls[0][1];
  expect(snapshot.messages).toHaveLength(64);
  expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeLessThan(
    512000
  );
  expect(result.events.at(-1)).toMatchObject({
    executionStatus: 'unknown',
    persistenceStatus: 'saved',
  });
});

it('saves multiple assistants by separate local IDs and stores only safe tool summaries', async () => {
  stream([
    ...textEvents,
    { type: 'TOOL_CALL_START', toolCallId: 'call', toolCallName: 'arithmetic' },
    {
      type: 'TOOL_CALL_RESULT',
      toolCallId: 'call',
      messageId: 'tool-message',
      role: 'tool',
      content: 'Tool result received.',
    },
    { type: 'TEXT_MESSAGE_START', messageId: 'second', role: 'assistant' },
    {
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: 'second',
      delta: 'Final response',
    },
    { type: 'RUN_FINISHED', threadId: 'native-thread', runId: initial.id },
  ]);
  const { events } = await run();
  const result = jest.mocked(saveRunResult).mock.calls[0][1];
  expect(result.messages).toHaveLength(2);
  expect(new Set(result.messages.map(message => message.id)).size).toBe(2);
  expect(result.messages[0].tools).toBeUndefined();
  expect(result.messages[1].tools).toEqual([
    {
      toolCallId: 'call',
      name: 'arithmetic',
      status: 'completed',
      runId: initial.id,
      order: 1,
    },
  ]);
  expect(events).toContainEqual({
    type: 'tool',
    toolCallId: 'call',
    name: 'arithmetic',
    status: 'completed',
    runId: initial.id,
    order: 1,
  });
});

it('retries only the same known save snapshot, never generation', async () => {
  jest
    .mocked(saveRunResult)
    .mockRejectedValueOnce(new Error('synthetic save failure'));
  const { events } = await run();
  expect(saveRunResult).toHaveBeenCalledTimes(2);
  expect(jest.mocked(saveRunResult).mock.calls[0][1]).toBe(
    jest.mocked(saveRunResult).mock.calls[1][1]
  );
  expect(streamTurn).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'saved',
  });
});

it('distinguishes a successful generation from failed saving', async () => {
  jest
    .mocked(saveRunResult)
    .mockRejectedValue(new Error('synthetic private DB error'));
  const { events, report } = await run();
  expect(events.at(-1)).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'failed',
    errorCode: 'AGENT_SAVE_FAILED',
  });
  expect(markRunUnknown).toHaveBeenCalledWith(initial.id, 'AGENT_SAVE_FAILED');
  expect(report).toHaveBeenCalledWith({
    runId: initial.id,
    code: 'AGENT_SAVE_FAILED',
  });
  expect(JSON.stringify(events)).not.toContain('private');
  expect(streamTurn).toHaveBeenCalledTimes(1);
});

it('retries binding the same known thread and does not recreate after a binding failure', async () => {
  jest.mocked(bindThread).mockRejectedValue(new Error('synthetic DB failure'));
  const { report } = await run();
  expect(createThread).toHaveBeenCalledTimes(1);
  expect(bindThread).toHaveBeenCalledTimes(2);
  expect(streamTurn).not.toHaveBeenCalled();
  expect(report).toHaveBeenCalledWith({
    runId: initial.id,
    code: 'AGENT_RESULT_UNKNOWN',
    orphanThreadId: 'native-thread',
  });
});

it.each([401, 403, 404, 422])(
  'records definitive HTTP %s rejection before execution without reserving an unknown slot',
  async status => {
    jest
      .mocked(createThread)
      .mockRejectedValueOnce(
        new LangChainUpstreamError('UPSTREAM_HTTP_ERROR', status)
      );
    const { events } = await run();
    expect(events.at(-1)).toMatchObject({
      executionStatus: 'error',
      persistenceStatus: 'saved',
    });
    expect(streamTurn).not.toHaveBeenCalled();
  }
);

it('never exposes credentials, native IDs or stored snapshots in public run summaries', () => {
  const value = publicAgentRun({
    ...initial,
    native_run_id: 'native-secret-id',
    result: { messages: [] },
  } as unknown as AgentRunRecord);
  expect(JSON.stringify(value)).not.toMatch(
    /native-secret|private-fingerprint|result|thread/
  );
});
