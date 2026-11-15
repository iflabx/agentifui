/** @jest-environment node */
import {
  AgentProtocolError,
  type AgentRunContext,
  type Event,
  EventType,
} from '@agentifui/shared';

import type { AgentClientEvent } from '../agent-run-execution';
import { LangChainEventBridge } from './langchain-prototype';

type StatusEvent = Extract<AgentClientEvent, { type: 'status' }>;

const context: AgentRunContext = {
  threadId: 'local-conversation',
  runId: 'local-run',
  submissionId: 'local-submission',
  userMessageId: 'local-user',
};
const accepted: AgentClientEvent = {
  type: 'accepted',
  conversationId: context.threadId,
  runId: context.runId,
  userMessageId: context.userMessageId,
};

it('bounds activity IDs for maximum-length local run identifiers', () => {
  const longContext = { ...context, runId: 'r'.repeat(255) };
  const bridge = new LangChainEventBridge(longContext);
  bridge.accept({
    ...accepted,
    type: 'accepted',
    runId: longContext.runId,
    conversationId: context.threadId,
    userMessageId: context.userMessageId,
  });
  const events = bridge.accept({
    type: 'tool',
    toolCallId: 'native-tool',
    name: 'lookup',
    status: 'running',
    runId: longContext.runId,
  });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: EventType.ACTIVITY_SNAPSHOT });
  expect(
    (events[0] as { messageId: string }).messageId.length
  ).toBeLessThanOrEqual(255);
});

function status(
  executionStatus: StatusEvent['executionStatus'],
  persistenceStatus: 'pending' | 'saved' | 'failed' = 'saved'
): StatusEvent {
  return {
    type: 'status',
    conversationId: context.threadId,
    runId: context.runId,
    executionStatus,
    persistenceStatus,
  };
}

function text(messageId: string, delta: string): AgentClientEvent {
  return { type: 'text', runId: context.runId, messageId, delta };
}

function terminals(events: Event[]) {
  return events.filter(
    event =>
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
  );
}

it('starts once with registered local acceptance metadata', () => {
  const bridge = new LangChainEventBridge(context);
  expect(bridge.accept(accepted)).toEqual([
    expect.objectContaining({
      type: EventType.RUN_STARTED,
      threadId: context.threadId,
      runId: context.runId,
      metadata: {
        'agentifui.acceptance.v1': {
          submissionId: context.submissionId,
          userMessageId: context.userMessageId,
        },
      },
    }),
  ]);
  expect(bridge.accept(accepted)).toEqual([]);
});

it('keeps empty start deltas on the same local assistant message', () => {
  const bridge = new LangChainEventBridge(context);
  bridge.accept(accepted);
  expect(bridge.accept(text('assistant', ''))).toMatchObject([
    { type: EventType.TEXT_MESSAGE_START, messageId: 'assistant' },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'assistant', delta: '' },
  ]);
  expect(bridge.accept(text('assistant', 'Hello'))).toMatchObject([
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'assistant',
      delta: 'Hello',
    },
  ]);
});

it('preserves multiple assistant IDs with interleaved tool activities', () => {
  const bridge = new LangChainEventBridge(context);
  const events = [
    ...bridge.accept(accepted),
    ...bridge.accept(text('assistant-first', 'Before')),
    ...bridge.accept({
      type: 'tool',
      runId: context.runId,
      toolCallId: 'native-call-first',
      name: 'arithmetic',
      status: 'running',
      messageId: 'assistant-first',
    }),
    ...bridge.accept(text('assistant-second', 'After')),
    ...bridge.accept(text('assistant-first', ' tool')),
    ...bridge.accept({
      type: 'tool',
      toolCallId: 'native-call-first',
      name: 'arithmetic',
      status: 'completed',
      messageId: 'assistant-first',
    }),
    ...bridge.accept(status('success')),
  ];
  expect(events.map(event => event.type)).toEqual([
    EventType.RUN_STARTED,
    EventType.TEXT_MESSAGE_START,
    EventType.TEXT_MESSAGE_CONTENT,
    EventType.ACTIVITY_SNAPSHOT,
    EventType.TEXT_MESSAGE_START,
    EventType.TEXT_MESSAGE_CONTENT,
    EventType.TEXT_MESSAGE_CONTENT,
    EventType.ACTIVITY_SNAPSHOT,
    EventType.TEXT_MESSAGE_END,
    EventType.TEXT_MESSAGE_END,
    EventType.RUN_FINISHED,
  ]);
  expect(
    events.filter(event => event.type === EventType.TEXT_MESSAGE_START)
  ).toMatchObject([
    { messageId: 'assistant-first' },
    { messageId: 'assistant-second' },
  ]);
  expect(
    events.filter(event => event.type === EventType.ACTIVITY_SNAPSHOT)
  ).toMatchObject([
    {
      messageId: 'local-run:tool-summary:0',
      content: { status: 'running', parentMessageId: 'assistant-first' },
    },
    {
      messageId: 'local-run:tool-summary:0',
      content: { status: 'completed', parentMessageId: 'assistant-first' },
    },
  ]);
  expect(terminals(events)).toHaveLength(1);
});

it('deduplicates summaries and never regresses a completed activity', () => {
  const bridge = new LangChainEventBridge(context);
  bridge.accept(accepted);
  const tool: AgentClientEvent = {
    type: 'tool',
    toolCallId: 'native-call',
    name: 'arithmetic',
    status: 'running',
  };
  const started = bridge.accept(tool);
  expect(bridge.accept(tool)).toEqual([]);
  const completed = bridge.accept({ ...tool, status: 'completed' });
  expect(completed).toMatchObject([{ messageId: 'local-run:tool-summary:0' }]);
  expect(started).toMatchObject([{ messageId: 'local-run:tool-summary:0' }]);
  expect(bridge.accept({ ...tool, status: 'completed' })).toEqual([]);
  expect(bridge.accept(tool)).toEqual([]);
  expect(
    bridge.accept({ ...tool, toolCallId: 'another-native-call' })
  ).toMatchObject([{ messageId: 'local-run:tool-summary:1' }]);
});

it('omits unknown and historical parents without inventing assistant messages', () => {
  const bridge = new LangChainEventBridge({
    ...context,
    history: [{ id: 'old-assistant', role: 'assistant', content: 'History' }],
  });
  bridge.accept(accepted);
  for (const [ordinal, messageId] of [
    undefined,
    'native-message',
    'old-assistant',
  ].entries()) {
    const events = bridge.accept({
      type: 'tool',
      toolCallId: `native-call-${ordinal}`,
      name: 'lookup_test_document',
      status: 'running',
      ...(messageId ? { messageId } : {}),
    });
    expect(events).toMatchObject([
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        content: { name: 'lookup_test_document', status: 'running' },
      },
    ]);
    expect(events[0]).not.toHaveProperty('content.parentMessageId');
  }
  const finished = bridge.accept(status('success'));
  expect(finished.map(event => event.type)).toEqual([EventType.RUN_FINISHED]);
});

it('finishes successful execution even when saving fails and accepts late persistence', () => {
  const bridge = new LangChainEventBridge(context);
  expect(bridge.persistenceStatus).toBe('pending');
  bridge.accept(accepted);
  bridge.accept(text('assistant', 'Complete'));
  expect(bridge.accept(status('running', 'pending'))).toEqual([]);
  const finished = bridge.accept(status('success', 'failed'));
  expect(terminals(finished)).toMatchObject([
    { type: EventType.RUN_FINISHED, outcome: { type: 'success' } },
  ]);
  expect(bridge.persistenceStatus).toBe('failed');
  expect(bridge.accept(status('success', 'saved'))).toEqual([]);
  expect(bridge.persistenceStatus).toBe('saved');
  expect(bridge.accept(status('success', 'saved'))).toEqual([]);
  expect(bridge.end()).toEqual([]);
  expect(
    Object.getOwnPropertyDescriptor(
      LangChainEventBridge.prototype,
      'persistenceStatus'
    )?.set
  ).toBeUndefined();
});

it.each([
  ['unknown', 'AGENT_STREAM_INCOMPLETE'],
  ['error', 'AGENT_RUN_FAILED'],
  ['interrupted', 'AGENT_INTERRUPTED_UNSUPPORTED'],
] as const)(
  'closes partial text safely for %s without claiming HITL',
  (outcome, code) => {
    const bridge = new LangChainEventBridge(context);
    bridge.accept(accepted);
    const partial = bridge.accept(text('assistant', 'Partial response'));
    const failed = bridge.accept({
      ...status(outcome),
      errorCode: 'PRIVATE_ERROR',
    });
    expect(partial).toContainEqual(
      expect.objectContaining({ delta: 'Partial response' })
    );
    expect(failed).toMatchObject([
      { type: EventType.TEXT_MESSAGE_END, messageId: 'assistant' },
      { type: EventType.RUN_ERROR, code },
    ]);
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_ERROR');
    expect(bridge.end()).toEqual([]);
  }
);

it('fails EOF without a terminal once, including before acceptance', () => {
  for (const withAcceptance of [false, true]) {
    const bridge = new LangChainEventBridge(context);
    if (withAcceptance) {
      bridge.accept(accepted);
      bridge.accept(text('assistant', 'Partial'));
    }
    expect(terminals(bridge.end())).toMatchObject([
      { type: EventType.RUN_ERROR, code: 'AGENT_STREAM_INCOMPLETE' },
    ]);
    expect(bridge.end()).toEqual([]);
    expect(bridge.accept(status('unknown', 'failed'))).toEqual([]);
    expect(bridge.persistenceStatus).toBe('failed');
  }
});

it('allows a registered failure as the first event without synthetic acceptance', () => {
  const bridge = new LangChainEventBridge(context);
  expect(bridge.accept(status('error', 'failed'))).toMatchObject([
    { type: EventType.RUN_ERROR, code: 'AGENT_RUN_FAILED' },
  ]);
  expect(bridge.persistenceStatus).toBe('failed');
  expect(bridge.accept(status('error', 'saved'))).toEqual([]);
  expect(bridge.persistenceStatus).toBe('saved');
});

it('does not expose native IDs, parameter/result fields, or summary bodies', () => {
  const bridge = new LangChainEventBridge(context);
  const input = Object.assign(
    {
      type: 'tool' as const,
      toolCallId: 'native-call-private',
      name: 'arithmetic',
      status: 'completed' as const,
      messageId: 'native-parent-private',
      summary: 'SYNTHETIC_PRIVATE_SUMMARY',
    },
    {
      arguments: { private: 'SYNTHETIC_PRIVATE_ARGS' },
      result: 'SYNTHETIC_PRIVATE_RESULT',
      threadId: 'native-thread-private',
      nativeRunId: 'native-run-private',
    }
  );
  const events = [
    ...bridge.accept(accepted),
    ...bridge.accept(input),
    ...bridge.accept({
      ...status('success'),
      errorCode: 'SYNTHETIC_PRIVATE_ERROR',
    }),
  ];
  expect(events[1]).toMatchObject({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: 'local-run:tool-summary:0',
    content: { name: 'arithmetic', status: 'completed' },
  });
  const encoded = JSON.stringify(events);
  expect(encoded).not.toMatch(/native-|SYNTHETIC_PRIVATE|TOOL_CALL/);
});

it.each([
  { ...accepted, conversationId: 'other-conversation' },
  { ...accepted, runId: 'other-run' },
  { ...accepted, userMessageId: 'other-user-message' },
] as AgentClientEvent[])(
  'rejects mismatched acceptance without starting',
  event => {
    const bridge = new LangChainEventBridge(context);
    expect(() => bridge.accept(event)).toThrow(AgentProtocolError);
    expect(bridge.accept(accepted)[0]).toMatchObject({
      type: EventType.RUN_STARTED,
    });
  }
);

it('rejects missing acceptance, cross-run content, foreign status and reserved message IDs', () => {
  const bridge = new LangChainEventBridge({
    ...context,
    history: [
      { id: 'historical-assistant', role: 'assistant', content: 'Old' },
    ],
  });
  expect(() => bridge.accept(text('assistant', 'Too soon'))).toThrow(
    AgentProtocolError
  );
  expect(() => bridge.accept(status('success'))).toThrow(AgentProtocolError);
  bridge.accept(accepted);
  for (const event of [
    { ...text('assistant', 'Foreign'), runId: 'other-run' },
    {
      type: 'tool',
      runId: 'other-run',
      toolCallId: 'native-call',
      name: 'arithmetic',
      status: 'running',
    },
    { ...status('error', 'failed'), conversationId: 'other-conversation' },
    { ...status('error', 'failed'), runId: 'other-run' },
    text(context.userMessageId, 'Overwrite user'),
    text('historical-assistant', 'Overwrite history'),
  ] as AgentClientEvent[]) {
    expect(() => bridge.accept(event)).toThrow(AgentProtocolError);
  }
  expect(bridge.persistenceStatus).toBe('pending');
  bridge.accept(status('success'));
  expect(() => bridge.accept(text('assistant', 'Late'))).toThrow(
    AgentProtocolError
  );
  expect(() =>
    bridge.accept({ ...status('success'), runId: 'other-run' })
  ).toThrow(AgentProtocolError);
  expect(() => bridge.accept(accepted)).toThrow(AgentProtocolError);
});

it('keeps deterministic activity IDs separate from local text and history IDs', () => {
  function project() {
    const bridge = new LangChainEventBridge({
      ...context,
      history: [
        { id: 'local-run:tool-summary:0', role: 'assistant', content: 'Old' },
      ],
    });
    bridge.accept(accepted);
    bridge.accept(text('local-run:tool-summary:1', 'Local'));
    const events = bridge.accept({
      type: 'tool',
      toolCallId: 'native-call',
      name: 'arithmetic',
      status: 'running',
    });
    expect(() =>
      bridge.accept(text('local-run:tool-summary:2', 'Collision'))
    ).toThrow(AgentProtocolError);
    return events;
  }
  expect(project()).toEqual(project());
  expect(project()).toMatchObject([{ messageId: 'local-run:tool-summary:2' }]);
});
