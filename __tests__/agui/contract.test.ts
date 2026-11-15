/** @jest-environment node */
import {
  AGUI_PROTOCOL_VERSION,
  AGUI_TOOL_SUMMARY,
  AgentEventWriter,
  AgentProtocolError,
  type AgentRunContext,
  EventType,
  MAX_PROJECTION_BYTES,
  MAX_PROJECTION_MESSAGES,
  parseAgentEvent,
  parseAgentMessages,
} from '../../packages/shared/src/agui';

const context: AgentRunContext = {
  threadId: 'local-thread',
  runId: 'local-run',
  submissionId: 'local-submission',
  userMessageId: 'local-user-message',
};

describe('AG-UI pinned contract', () => {
  it('uses protocol 1.0 independently from the SDK version', () => {
    expect(AGUI_PROTOCOL_VERSION).toBe('1.0');
    expect(new AgentEventWriter(context).start()).toEqual([
      expect.objectContaining({
        type: EventType.RUN_STARTED,
        protocolVersion: '1.0',
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
  });

  it('ignores unknown discriminators but rejects malformed known events', () => {
    expect(
      parseAgentEvent({ type: 'FUTURE_EVENT', payload: {} })
    ).toBeUndefined();
    expect(() =>
      parseAgentEvent({ type: EventType.TEXT_MESSAGE_CONTENT })
    ).toThrow(AgentProtocolError);
    expect(() =>
      parseAgentEvent({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'assistant',
        delta: 1,
      })
    ).toThrow(AgentProtocolError);
    expect(() => parseAgentEvent(null)).toThrow(AgentProtocolError);
  });

  it('bounds snapshots and rejects duplicate identifiers', () => {
    const message = { id: 'message', role: 'assistant', content: 'hello' };
    expect(() => parseAgentMessages([message, message])).toThrow(
      'AGENT_MESSAGES_INVALID'
    );
    expect(() =>
      parseAgentMessages(Array(MAX_PROJECTION_MESSAGES + 1).fill(message))
    ).toThrow('AGENT_MESSAGES_INVALID');
    expect(() =>
      parseAgentMessages([
        { ...message, content: 'x'.repeat(MAX_PROJECTION_BYTES) },
      ])
    ).toThrow('AGENT_PROJECTION_LIMIT');
  });
});

describe('AG-UI public writer', () => {
  it('keeps historical messages and emits complete replacement snapshots', () => {
    const writer = new AgentEventWriter({
      ...context,
      history: [
        { id: 'previous', role: 'assistant', content: 'old' },
        { id: context.userMessageId, role: 'user', content: 'question' },
      ],
    });
    writer.start();
    writer.text('assistant', 'a long answer');
    writer.toolSummary('activity', {
      name: 'search',
      status: 'completed',
      parentMessageId: 'assistant',
    });
    const snapshot = writer.replace('assistant', 'short');
    expect(snapshot).toEqual([
      {
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [
          { id: 'previous', role: 'assistant', content: 'old' },
          { id: context.userMessageId, role: 'user', content: 'question' },
          { id: 'assistant', role: 'assistant', content: 'short' },
          {
            id: 'activity',
            role: 'activity',
            activityType: AGUI_TOOL_SUMMARY,
            content: {
              name: 'search',
              status: 'completed',
              parentMessageId: 'assistant',
            },
          },
        ],
      },
    ]);
    expect(writer.replace('assistant', '')[0]).toMatchObject({
      messages: expect.arrayContaining([
        { id: 'assistant', role: 'assistant', content: '' },
      ]),
    });
    expect(writer.text('assistant', 'new')[0]).toMatchObject({
      type: EventType.TEXT_MESSAGE_CONTENT,
      delta: 'new',
    });
  });

  it('opens and closes each text exactly once for a multi-message run', () => {
    const writer = new AgentEventWriter(context);
    const events = [
      ...writer.start(),
      ...writer.text('first', 'one'),
      ...writer.text('second', 'two'),
      ...writer.text('first', 'more'),
      ...writer.finish(),
    ];
    expect(events.map(event => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    events.forEach(event => expect(parseAgentEvent(event)).toEqual(event));
  });

  it('rejects output identifiers colliding with history or the current input', () => {
    const writer = new AgentEventWriter({
      ...context,
      history: [{ id: 'history', role: 'assistant', content: 'old' }],
    });
    writer.start();
    expect(() => writer.text('history', 'bad')).toThrow(
      'AGENT_MESSAGE_OWNERSHIP'
    );
    expect(() => writer.replace('history', 'bad')).toThrow(
      'AGENT_MESSAGE_OWNERSHIP'
    );
    expect(() => writer.text(context.userMessageId, 'bad')).toThrow(
      'AGENT_MESSAGE_ID_INVALID'
    );
    expect(() => writer.text('', 'bad')).toThrow('AGENT_MESSAGE_ID_INVALID');
  });

  it('does not retain content that failed the projection bound', () => {
    const writer = new AgentEventWriter(context);
    writer.start();
    writer.text('assistant', 'safe');
    expect(() =>
      writer.text('assistant', 'x'.repeat(MAX_PROJECTION_BYTES))
    ).toThrow('AGENT_PROJECTION_LIMIT');
    expect(writer.replace('assistant', 'safe')[0]).toMatchObject({
      messages: [{ id: 'assistant', role: 'assistant', content: 'safe' }],
    });
    expect(() =>
      writer.replace('assistant', 'x'.repeat(MAX_PROJECTION_BYTES))
    ).toThrow('AGENT_PROJECTION_LIMIT');
    expect(writer.text('assistant', ' after')[0]).toMatchObject({
      delta: ' after',
    });
    expect(writer.finish().at(-1)).toMatchObject({
      outcome: { type: 'success' },
    });
  });

  it('whitelists activity fields and requires an owned assistant parent', () => {
    const writer = new AgentEventWriter(context);
    writer.start();
    const summary = {
      name: 'lookup',
      status: 'running' as const,
      rawEvent: { secret: 'not-public' },
      arguments: 'not-public',
    };
    expect(writer.toolSummary('activity', summary)).toEqual([
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: 'activity',
        activityType: AGUI_TOOL_SUMMARY,
        replace: true,
        content: { name: 'lookup', status: 'running' },
      },
    ]);
    expect(() =>
      writer.toolSummary('second', { ...summary, parentMessageId: 'activity' })
    ).toThrow('AGENT_ACTIVITY_INVALID');
    expect(() =>
      writer.toolSummary('second', {
        ...summary,
        name: 'https://private.invalid?token=secret',
      })
    ).toThrow('AGENT_ACTIVITY_INVALID');
  });

  it('allows a safe pre-start failure and prohibits events after terminal', () => {
    const writer = new AgentEventWriter(context);
    expect(writer.fail()).toEqual([
      {
        type: EventType.RUN_ERROR,
        code: 'AGENT_RUN_FAILED',
        message: 'Agent execution failed.',
      },
    ]);
    expect(() => writer.start()).toThrow(AgentProtocolError);
    expect(() => writer.fail()).toThrow('AGENT_RUN_CLOSED');
    expect(() => writer.text('assistant', 'late')).toThrow(
      'AGENT_RUN_NOT_ACTIVE'
    );
  });

  it('preserves cancellation as distinct from success', () => {
    const writer = new AgentEventWriter(context);
    writer.start();
    expect(writer.finish('cancelled').at(-1)).toMatchObject({
      outcome: { type: 'cancelled' },
    });
  });
});
