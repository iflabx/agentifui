/** @jest-environment node */
import {
  AGUI_TOOL_SUMMARY,
  AgentEventProjection,
  AgentEventWriter,
  type AgentRunContext,
  EventType,
  MAX_PROJECTION_BYTES,
} from '../../packages/shared/src/agui';

const context: AgentRunContext = {
  threadId: 'local-thread',
  runId: 'local-run',
  submissionId: 'local-submission',
  userMessageId: 'local-user',
};
const started = {
  type: EventType.RUN_STARTED,
  threadId: context.threadId,
  runId: context.runId,
  protocolVersion: '1.0',
};

describe('AG-UI bounded common projection', () => {
  it('forks pending text and trusted output scope without mutating the original', () => {
    const projection = new AgentEventProjection({
      ...context,
      history: [{ id: 'prior', role: 'assistant', content: 'old' }],
    });
    projection.accept(started);
    projection.accept({
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'current',
      role: 'assistant',
    });
    const candidate = projection.fork();
    candidate.accept({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'current',
      delta: 'preview',
    });
    candidate.accept({ type: 'FUTURE_EVENT' });
    candidate.accept({
      type: EventType.TEXT_MESSAGE_END,
      messageId: 'current',
    });
    candidate.accept({
      type: EventType.RUN_FINISHED,
      threadId: context.threadId,
      runId: context.runId,
    });
    expect(candidate.snapshot()).toMatchObject({
      status: 'succeeded',
      outputMessageIds: ['current'],
      warnings: ['unrecognized-event'],
    });
    expect(projection.snapshot()).toMatchObject({
      status: 'running',
      messages: [{ content: 'old' }, { content: '' }],
      outputMessageIds: ['current'],
      warnings: [],
    });
    expect(() =>
      projection.accept({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'current',
        delta: 'actual',
      })
    ).not.toThrow();
  });

  it('reopens a closed message without clearing its content or duplicating it', () => {
    const projection = new AgentEventProjection(context);
    const start = {
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'answer',
      role: 'assistant',
      name: 'speaker',
    };
    projection.accept(started);
    projection.accept(start);
    expect(() => projection.accept(start)).toThrow(
      'AGENT_MESSAGE_ALREADY_EXISTS'
    );
    projection.accept({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'answer',
      delta: 'first',
    });
    projection.accept({
      type: EventType.TEXT_MESSAGE_END,
      messageId: 'answer',
    });
    expect(() => projection.accept({ ...start, name: 'other' })).toThrow(
      'AGENT_MESSAGE_ROLE_MISMATCH'
    );
    projection.accept(start);
    projection.accept({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'answer',
      delta: ' second',
    });
    projection.accept({
      type: EventType.TEXT_MESSAGE_END,
      messageId: 'answer',
    });
    projection.accept({
      type: EventType.RUN_FINISHED,
      threadId: context.threadId,
      runId: context.runId,
    });
    expect(projection.snapshot()).toMatchObject({
      status: 'succeeded',
      messages: [{ id: 'answer', content: 'first second', name: 'speaker' }],
    });
    expect(projection.snapshot().messages).toHaveLength(1);
  });

  it('preserves prior-run activities and reasoning when a new run replaces text', () => {
    const history = [
      { id: 'old-answer', role: 'assistant' as const, content: 'previous' },
      {
        id: 'old-tool',
        role: 'activity' as const,
        activityType: AGUI_TOOL_SUMMARY,
        content: { name: 'lookup', status: 'completed', debug: 'private' },
      },
      {
        id: 'old-reasoning',
        role: 'reasoning' as const,
        content: 'public reasoning',
      },
      { id: context.userMessageId, role: 'user' as const, content: 'question' },
    ];
    const writer = new AgentEventWriter({ ...context, history });
    const projection = new AgentEventProjection({ ...context, history });
    const events = [
      ...writer.start(),
      ...writer.text('answer', 'long answer'),
      ...writer.toolSummary('new-tool', {
        name: 'lookup',
        status: 'completed',
      }),
      ...writer.replace('answer', ''),
      ...writer.finish(),
    ];
    events.forEach(event => projection.accept(event));
    expect(projection.snapshot().messages.map(message => message.id)).toEqual([
      'old-answer',
      'old-tool',
      'old-reasoning',
      context.userMessageId,
      'answer',
      'new-tool',
    ]);
    expect(JSON.stringify(events)).not.toContain('private');
    expect(projection.snapshot().outputMessageIds).toEqual([
      'answer',
      'new-tool',
    ]);
    expect(JSON.stringify(events)).not.toContain('outputMessageIds');
    expect(() => writer.text('old-answer', 'overwrite')).toThrow();
  });
  it('treats an incomplete error after confirmed completion as failure, not unknown', () => {
    const projection = new AgentEventProjection(context);
    projection.accept(started);
    projection.accept({
      type: EventType.RUN_FINISHED,
      threadId: context.threadId,
      runId: context.runId,
      outcome: { type: 'success' },
    });
    projection.accept({
      type: EventType.RUN_ERROR,
      message: 'Incomplete flush',
      code: 'AGENT_STREAM_INCOMPLETE',
    });
    expect(projection.snapshot()).toMatchObject({
      status: 'failed',
      errorCode: 'AGENT_STREAM_INCOMPLETE',
    });
  });

  it('applies the per-role snapshot exception independently to reasoning messages', () => {
    const projection = new AgentEventProjection({
      ...context,
      history: [
        {
          id: 'reasoning',
          role: 'reasoning',
          content: 'retained display data',
        },
      ],
    });
    projection.accept(started);
    projection.accept({ type: EventType.MESSAGES_SNAPSHOT, messages: [] });
    expect(projection.snapshot().messages.map(message => message.id)).toEqual([
      'reasoning',
    ]);
    projection.accept({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [
        {
          id: 'new-reasoning',
          role: 'reasoning',
          content: 'replacement display data',
        },
      ],
    });
    expect(projection.snapshot().messages.map(message => message.id)).toEqual([
      'new-reasoning',
    ]);
  });
  it.each(['success', 'cancelled', 'interrupt'] as const)(
    'corrects a late error after %s without losing partial messages',
    outcome => {
      const projection = new AgentEventProjection(context);
      projection.accept(started);
      projection.accept({
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [{ id: 'assistant', role: 'assistant', content: 'retained' }],
      });
      projection.accept({
        type: EventType.RUN_FINISHED,
        threadId: context.threadId,
        runId: context.runId,
        outcome:
          outcome === 'interrupt'
            ? {
                type: 'interrupt',
                interrupts: [{ id: 'pending', reason: 'input' }],
              }
            : { type: outcome },
      });
      projection.accept({
        type: EventType.RUN_ERROR,
        message: 'private diagnostic',
        code: 'PRIVATE',
      });
      expect(projection.snapshot()).toMatchObject({
        status: 'failed',
        errorCode: 'AGENT_RUN_FAILED',
        messages: [{ content: 'retained' }],
      });
      expect(JSON.stringify(projection.snapshot())).not.toContain('private');
      expect(() =>
        projection.accept({ type: EventType.RUN_ERROR, message: 'duplicate' })
      ).toThrow('AGENT_RUN_NOT_ACTIVE');
    }
  );

  it('reconciles snapshots in place and preserves undeclared client activity', () => {
    const projection = new AgentEventProjection({
      ...context,
      history: [
        { id: 'first', role: 'assistant', content: 'first' },
        {
          id: 'activity',
          role: 'activity',
          activityType: AGUI_TOOL_SUMMARY,
          content: { name: 'lookup', status: 'running' },
        },
        { id: 'second', role: 'assistant', content: 'second' },
        { id: 'omitted', role: 'user', content: 'drop me' },
      ],
    });
    projection.accept(started);
    projection.accept({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [
        { id: 'second', role: 'assistant', content: 'updated second' },
        { id: 'first', role: 'assistant', content: 'updated first' },
        { id: 'new', role: 'assistant', content: 'appended' },
      ],
    });
    expect(projection.snapshot().messages.map(message => message.id)).toEqual([
      'first',
      'activity',
      'second',
      'new',
    ]);
    projection.accept({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [
        {
          id: 'new-activity',
          role: 'activity',
          activityType: AGUI_TOOL_SUMMARY,
          content: { name: 'lookup', status: 'completed' },
        },
      ],
    });
    expect(projection.snapshot().messages.map(message => message.id)).toEqual([
      'new-activity',
    ]);
  });

  it('does not merge or change the type of an existing activity on replace:false', () => {
    const projection = new AgentEventProjection(context);
    projection.accept(started);
    const activity = {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: 'activity',
      activityType: AGUI_TOOL_SUMMARY,
      content: { name: 'lookup', status: 'running' },
    };
    projection.accept({ ...activity, replace: false });
    const before = projection.snapshot().messages;
    projection.accept({
      ...activity,
      replace: false,
      content: { status: 'completed' },
    });
    projection.accept({
      ...activity,
      replace: false,
      activityType: 'future.activity.v1',
      content: {},
    });
    expect(projection.snapshot().messages).toEqual(before);
  });
  it('preserves the prior projection when an oversized delta is rejected', () => {
    const projection = new AgentEventProjection(context);
    projection.accept(started);
    projection.accept({
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'assistant',
    });
    projection.accept({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'assistant',
      delta: 'safe',
    });
    expect(() =>
      projection.accept({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'assistant',
        delta: 'x'.repeat(MAX_PROJECTION_BYTES),
      })
    ).toThrow('AGENT_PROJECTION_LIMIT');
    expect(projection.snapshot().messages).toEqual([
      { id: 'assistant', role: 'assistant', content: 'safe' },
    ]);
  });

  it('keeps partial-result failure distinguishable without retaining private errors', () => {
    const projection = new AgentEventProjection(context);
    projection.accept(started);
    projection.accept({
      type: EventType.RUN_ERROR,
      code: 'AGENT_PARTIAL_RESULT',
      message: 'generic',
    });
    expect(projection.snapshot()).toMatchObject({
      status: 'failed',
      errorCode: 'AGENT_PARTIAL_RESULT',
    });
    const untrusted = new AgentEventProjection(context);
    untrusted.accept({
      type: EventType.RUN_ERROR,
      code: 'PRIVATE_ERROR',
      message: 'private diagnostic',
    });
    expect(untrusted.snapshot()).toMatchObject({
      errorCode: 'AGENT_RUN_FAILED',
    });
    expect(JSON.stringify(untrusted.snapshot())).not.toContain('private');
  });
  it('projects multiple messages and tools in event order with full replacement', () => {
    const history = [
      { id: 'old', role: 'user' as const, content: 'old question' },
    ];
    const writer = new AgentEventWriter({ ...context, history });
    const projection = new AgentEventProjection({ ...context, history });
    const events = [
      ...writer.start(),
      ...writer.text('first', 'long answer'),
      ...writer.toolSummary('tool', {
        name: 'lookup',
        status: 'running',
        parentMessageId: 'first',
      }),
      ...writer.text('second', 'second answer'),
      ...writer.replace('first', 'short'),
      ...writer.toolSummary('tool', {
        name: 'lookup',
        status: 'completed',
        parentMessageId: 'first',
      }),
      ...writer.text('first', '!'),
      ...writer.finish(),
    ];
    events.forEach(event => projection.accept(event));
    projection.end();
    expect(projection.snapshot()).toMatchObject({
      schemaVersion: 2,
      status: 'succeeded',
      messages: [
        history[0],
        { id: 'first', role: 'assistant', content: 'short!' },
        {
          id: 'tool',
          role: 'activity',
          activityType: AGUI_TOOL_SUMMARY,
          content: {
            name: 'lookup',
            status: 'completed',
            parentMessageId: 'first',
          },
        },
        { id: 'second', role: 'assistant', content: 'second answer' },
      ],
      warnings: [],
    });
    const detached = projection.snapshot();
    detached.messages.splice(0);
    expect(projection.snapshot().messages).toHaveLength(4);
  });

  it('reapplies complete snapshots without appending duplicate messages', () => {
    const projection = new AgentEventProjection(context);
    projection.accept(started);
    const snapshot = {
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [{ id: 'answer', role: 'assistant', content: '' }],
    };
    projection.accept(snapshot);
    projection.accept(snapshot);
    expect(projection.snapshot().messages).toEqual(snapshot.messages);
  });

  it.each(['idle', 'running'] as const)(
    'does not infer success from %s EOF',
    status => {
      const projection = new AgentEventProjection(context);
      if (status === 'running') projection.accept(started);
      projection.end();
      expect(projection.snapshot()).toMatchObject({
        status: 'unknown',
        warnings: ['stream-ended-without-terminal'],
      });
    }
  );

  it('treats pre-start error as failure and never overwrites an existing terminal', () => {
    const projection = new AgentEventProjection(context);
    projection.accept({
      type: EventType.RUN_ERROR,
      message: 'Execution failed.',
    });
    expect(projection.snapshot().status).toBe('failed');
    expect(() => projection.accept(started)).toThrow('AGENT_RUN_NOT_ACTIVE');
    expect(() =>
      projection.accept({ type: EventType.RUN_ERROR, message: 'late' })
    ).toThrow('AGENT_RUN_NOT_ACTIVE');
  });

  it.each(['success', 'cancelled', 'interrupt'] as const)(
    'preserves %s outcome',
    outcome => {
      const projection = new AgentEventProjection(context);
      projection.accept(started);
      projection.accept({
        type: EventType.RUN_FINISHED,
        threadId: context.threadId,
        runId: context.runId,
        outcome:
          outcome === 'interrupt'
            ? {
                type: 'interrupt',
                interrupts: [{ id: 'pending', reason: 'human-input' }],
              }
            : { type: outcome },
      });
      expect(projection.snapshot().status).toBe(
        outcome === 'success'
          ? 'succeeded'
          : outcome === 'interrupt'
            ? 'interrupted'
            : 'cancelled'
      );
    }
  );

  it('rejects cross-run context and major version mismatches', () => {
    expect(() =>
      new AgentEventProjection(context).accept({ ...started, runId: 'other' })
    ).toThrow('AGENT_RUN_ID_MISMATCH');
    expect(() =>
      new AgentEventProjection(context).accept({
        ...started,
        protocolVersion: '2.0',
      })
    ).toThrow('AGENT_PROTOCOL_VERSION_UNSUPPORTED');
  });

  it('ignores unknown extensions but rejects malformed known events', () => {
    const projection = new AgentEventProjection(context);
    projection.accept(started);
    projection.accept({ type: 'FUTURE_EVENT', rawEvent: 'not retained' });
    projection.accept({
      type: EventType.CUSTOM,
      name: 'future.extension.v1',
      value: {},
    });
    expect(projection.snapshot().warnings).toEqual([
      'unrecognized-event',
      'unsupported-event:CUSTOM',
    ]);
    expect(() =>
      projection.accept({ type: EventType.TEXT_MESSAGE_CONTENT, delta: 1 })
    ).toThrow('AGENT_EVENT_INVALID');
  });

  it('enforces text lifecycle and rejects snapshots changing an open message role', () => {
    const projection = new AgentEventProjection(context);
    projection.accept(started);
    expect(() =>
      projection.accept({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'assistant',
        delta: 'orphan',
      })
    ).toThrow('AGENT_MESSAGE_NOT_OPEN');
    projection.accept({
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'assistant',
    });
    expect(() =>
      projection.accept({
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [{ id: 'assistant', role: 'user', content: 'wrong' }],
      })
    ).toThrow('AGENT_SNAPSHOT_DROPPED_OPEN_MESSAGE');
    expect(() =>
      projection.accept({
        type: EventType.RUN_FINISHED,
        threadId: context.threadId,
        runId: context.runId,
      })
    ).toThrow('AGENT_RUN_TERMINAL_INVALID');
  });

  it('keeps unsupported activities inert and strips tool metadata', () => {
    const projection = new AgentEventProjection(context);
    projection.accept(started);
    projection.accept({
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: 'unknown',
      activityType: 'unrecognized.v1',
      content: { html: '<script>unsafe</script>' },
    });
    projection.accept({
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: 'tool',
      activityType: AGUI_TOOL_SUMMARY,
      content: { name: 'lookup', status: 'running', arguments: 'private' },
    });
    expect(projection.snapshot().messages).toEqual([
      {
        id: 'unknown',
        role: 'activity',
        activityType: 'unrecognized.v1',
        content: {},
      },
      {
        id: 'tool',
        role: 'activity',
        activityType: AGUI_TOOL_SUMMARY,
        content: { name: 'lookup', status: 'running' },
      },
    ]);
  });
});
