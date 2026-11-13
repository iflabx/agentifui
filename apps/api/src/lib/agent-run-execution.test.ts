/** @jest-environment node */
import type { AgentApp } from './agent-app';
import { executeAgentRun, publicAgentRun } from './agent-run-execution';
import {
  type AgentRunRecord,
  bindThread,
  markRunUnknown,
  recordNativeRun,
  saveRunResult,
} from './agent-runs-repository';
import {
  type AGUIEvent,
  LangChainUpstreamError,
  createThread,
  streamTurn,
} from './langchain/transport';

jest.mock('./agent-runs-repository', () => ({
  bindThread: jest.fn(),
  markRunUnknown: jest.fn(),
  recordNativeRun: jest.fn(),
  saveRunResult: jest.fn(),
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
  jest.mocked(streamTurn).mockImplementation(async function* () {
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
});

async function run(overrides: Partial<AgentRunRecord> = {}) {
  const events: unknown[] = [];
  const report = jest.fn();
  await executeAgentRun({
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
  expect(result.messages[0].tools).toEqual([
    { toolCallId: 'call', name: 'arithmetic', status: 'completed' },
  ]);
  expect(events).toContainEqual({
    type: 'tool',
    toolCallId: 'call',
    name: 'arithmetic',
    status: 'completed',
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
