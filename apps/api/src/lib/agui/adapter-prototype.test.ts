/** @jest-environment node */
import {
  AGUI_TOOL_SUMMARY,
  type AgentRunContext,
  type Event,
  EventType,
} from '@agentifui/shared';

import type { AgentClientEvent } from '../agent-run-execution';
import {
  type PrototypeRunInput,
  type PrototypeTurn,
  createDifyExecutionPrototype,
  createLangChainExecutionPrototype,
  prototypeRunInput,
} from './adapter-prototype';

const context: AgentRunContext = {
  threadId: 'thread',
  runId: 'run',
  submissionId: 'submission',
  userMessageId: 'question',
  history: [
    { id: 'previous', role: 'assistant', content: 'prior answer' },
    {
      id: 'previous-tool',
      role: 'activity',
      activityType: AGUI_TOOL_SUMMARY,
      content: { name: 'lookup', status: 'completed' },
    },
    { id: 'question', role: 'user', content: 'current question' },
  ],
};
const request: PrototypeRunInput = {
  appId: 'app',
  context,
  input: prototypeRunInput(context),
};
const query = { appId: 'app', threadId: 'thread', runId: 'run' };

async function* fixture<T>(events: readonly T[]) {
  yield* events;
}

const difyEvents = [
  ...['Fixture', ' ', 'answer', '.', ''].map(answer => ({
    event: 'message',
    answer,
    id: 'native-message',
    message_id: 'native-message',
    conversation_id: 'native-thread',
    task_id: 'native-task',
    created_at: 1,
    from_variable_selector: [],
  })),
  {
    event: 'message_end',
    id: 'native-message',
    message_id: 'native-message',
    conversation_id: 'native-thread',
    task_id: 'native-task',
    created_at: 1,
    files: [],
    metadata: {
      reasoning: {},
      retriever_resources: [],
      usage: {
        prompt_tokens: 4,
        completion_tokens: 3,
        total_tokens: 7,
        latency: 0.1,
        total_price: '0',
        currency: 'USD',
      },
    },
  },
];
const langchainEvents: AgentClientEvent[] = [
  {
    type: 'accepted',
    conversationId: 'thread',
    runId: 'run',
    userMessageId: 'question',
  },
  { type: 'text', runId: 'run', messageId: 'answer', delta: 'Fixture answer.' },
  {
    type: 'status',
    conversationId: 'thread',
    runId: 'run',
    executionStatus: 'success',
    persistenceStatus: 'failed',
  },
];

describe('disconnected common execution contract', () => {
  it.each(['dify', 'langchain'] as const)(
    'executes %s fixtures with the same trusted input, without resending prior history',
    async backend => {
      const observed: PrototypeTurn[] = [];
      const options = {
        appId: 'app',
        name: 'Fixture app',
        declared: { text: true },
      };
      const adapter =
        backend === 'dify'
          ? createDifyExecutionPrototype({
              ...options,
              profile: 'chatbot',
              assistantMessageId: () => 'answer',
              stream: turn => {
                observed.push(turn);
                return fixture(difyEvents);
              },
            })
          : createLangChainExecutionPrototype({
              ...options,
              stream: turn => {
                observed.push(turn);
                return fixture(langchainEvents);
              },
            });
      const events: Event[] = [];
      const result = await adapter.execute(request, event =>
        events.push(event)
      );
      expect(observed).toEqual([
        {
          threadId: 'thread',
          runId: 'run',
          userMessageId: 'question',
          content: 'current question',
        },
      ]);
      expect(result.projection).toMatchObject({
        status: 'succeeded',
        messages: [
          ...context.history!,
          { id: 'answer', role: 'assistant', content: 'Fixture answer.' },
        ],
      });
      expect(events[0].type).toBe(EventType.RUN_STARTED);
      expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
      expect(result.projection.outputMessageIds).toEqual(['answer']);
      expect(JSON.stringify(events)).not.toContain('native-');
      expect(result.persistenceStatus).toBe(
        backend === 'langchain' ? 'failed' : undefined
      );
    }
  );

  it('keeps declaration, implementation and product readiness distinct', () => {
    const adapter = createDifyExecutionPrototype({
      appId: 'app',
      name: 'Fixture app',
      profile: 'chatbot',
      stream: () => fixture([]),
      declared: { text: true, humanInput: false },
    });
    const descriptor = adapter.describe();
    expect(descriptor.capabilities.text).toEqual({
      declared: true,
      enabled: false,
      reason: 'runtime-not-integrated',
    });
    expect(descriptor.capabilities.humanInput.declared).toBe(false);
    expect(descriptor.capabilities.queryRun.declared).toBeUndefined();
    descriptor.name = 'changed';
    expect(adapter.describe().name).toBe('Fixture app');
  });

  it.each(['dify', 'langchain'] as const)(
    'sanitizes both %s emitted events and the returned projection',
    async backend => {
      const options = { appId: 'app', name: 'app' };
      const adapter =
        backend === 'dify'
          ? createDifyExecutionPrototype({
              ...options,
              profile: 'chatbot',
              stream: () => fixture(difyEvents),
            })
          : createLangChainExecutionPrototype({
              ...options,
              stream: () => fixture(langchainEvents),
            });
      const contextWithPrivateFields = {
        ...context,
        history: context.history!.map(message => ({
          ...message,
          debug: 'private-diagnostic',
          metadata: { token: 'private-token' },
          nativeBinding: 'private-thread',
        })),
      };
      const events: Event[] = [];
      const result = await adapter.execute(
        { ...request, context: contextWithPrivateFields },
        event => events.push(event)
      );
      expect(JSON.stringify({ events, result })).not.toContain('private-');
      expect(contextWithPrivateFields.history[0].debug).toBe(
        'private-diagnostic'
      );
    }
  );

  it('never executes to simulate unsupported queries', async () => {
    const stream = jest.fn(() => fixture(difyEvents));
    const adapter = createDifyExecutionPrototype({
      appId: 'app',
      name: 'app',
      profile: 'chatbot',
      stream,
    });
    expect(await adapter.queryRun(query)).toEqual({ status: 'unsupported' });
    expect(stream).not.toHaveBeenCalled();
  });

  it('reports confirmed query state separately from result completeness and strips private fields', async () => {
    const queryFn = jest.fn(async () => ({
      status: 'confirmed' as const,
      executionStatus: 'success' as const,
      resultComplete: false,
      nativeBinding: 'private',
    }));
    const adapter = createLangChainExecutionPrototype({
      appId: 'app',
      name: 'app',
      stream: () => fixture([]),
      query: queryFn,
    });
    expect(await adapter.queryRun(query)).toEqual({
      status: 'confirmed',
      executionStatus: 'success',
      resultComplete: false,
    });
    expect(await adapter.queryRun({ ...query, appId: 'other' })).toEqual({
      status: 'rejected',
    });
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('keeps query transport failures unknown without starting a model request', async () => {
    const stream = jest.fn(() => fixture([]));
    const adapter = createLangChainExecutionPrototype({
      appId: 'app',
      name: 'app',
      stream,
      query: async () => {
        throw new Error('private upstream error');
      },
    });
    expect(await adapter.queryRun(query)).toEqual({ status: 'unknown' });
    expect(stream).not.toHaveBeenCalled();
  });

  it.each(['app', 'run', 'history', 'resume', 'tools'] as const)(
    'rejects mismatched %s before invoking a transport',
    async invalid => {
      const stream = jest.fn(() => fixture(difyEvents));
      const adapter = createDifyExecutionPrototype({
        appId: 'app',
        name: 'app',
        profile: 'chatbot',
        stream,
      });
      const bad = structuredClone(request);
      if (invalid === 'app') bad.appId = 'other';
      if (invalid === 'run') bad.input.runId = 'other';
      if (invalid === 'history') bad.input.messages = [];
      if (invalid === 'resume')
        bad.input.resume = [
          { interruptId: 'pending', status: 'resolved', payload: 'yes' },
        ];
      if (invalid === 'tools')
        bad.input.tools = [
          { name: 'execute', description: '', parameters: {} },
        ];
      await expect(adapter.execute(bad, () => {})).rejects.toThrow(
        'AGENT_INPUT_INVALID'
      );
      expect(stream).not.toHaveBeenCalled();
    }
  );

  it('returns unknown after a truncated native stream and does not restart it', async () => {
    const stream = jest.fn(async function* () {
      yield difyEvents[0];
      throw new Error('private disconnect');
    });
    const events: Event[] = [];
    const adapter = createDifyExecutionPrototype({
      appId: 'app',
      name: 'app',
      profile: 'chatbot',
      stream,
    });
    const result = await adapter.execute(request, event => events.push(event));
    expect(result.projection.status).toBe('unknown');
    expect(stream).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(events)).not.toContain('private');
  });

  it('propagates sink failure rather than sending another event or restarting', async () => {
    const stream = jest.fn(() => fixture(difyEvents));
    const sink = jest.fn(() => {
      throw new Error('client closed');
    });
    const adapter = createDifyExecutionPrototype({
      appId: 'app',
      name: 'app',
      profile: 'chatbot',
      stream,
    });
    await expect(adapter.execute(request, sink)).rejects.toThrow(
      'client closed'
    );
    expect(sink).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
