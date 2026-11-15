/** @jest-environment node */
import {
  AgentEventProjection,
  AgentProtocolError,
  type AgentRunContext,
  type Event,
  EventType,
} from '@agentifui/shared';

import { DifyEventBridge } from './dify-prototype';

const context: AgentRunContext = {
  threadId: 'local-thread',
  runId: 'local-run',
  submissionId: 'local-submission',
  userMessageId: 'local-user',
  history: [
    { id: 'previous-user', role: 'user', content: 'Earlier question' },
    { id: 'previous-assistant', role: 'assistant', content: 'Earlier answer' },
    { id: 'local-user', role: 'user', content: 'Current question' },
  ],
};

function native(event: string, extra: Record<string, unknown> = {}) {
  return {
    event,
    task_id: 'native-task',
    conversation_id: 'native-conversation',
    message_id: 'native-message',
    id: 'native-message',
    created_at: 1,
    ...extra,
  };
}

function messageEnd(extra: Record<string, unknown> = {}) {
  return native('message_end', { metadata: {}, ...extra });
}

function workflowStart() {
  return native('workflow_started', {
    workflow_run_id: 'native-workflow',
    data: {
      id: 'native-workflow',
      workflow_id: 'native-definition',
      sequence_number: 1,
      created_at: 1,
    },
  });
}

function workflowFinish(
  status = 'succeeded',
  extra: Record<string, unknown> = {}
) {
  return native('workflow_finished', {
    workflow_run_id: 'native-workflow',
    data: { id: 'native-workflow', status, ...extra },
  });
}

function createBridge(profile: 'chatbot' | 'agent-chat' = 'chatbot') {
  return new DifyEventBridge({
    context,
    profile,
    assistantMessageId: 'local-assistant',
  });
}

function project(events: Event[]) {
  const projection = new AgentEventProjection({
    threadId: context.threadId,
    runId: context.runId,
    history: context.history ? [...context.history] : [],
  });
  for (const event of events) projection.accept(event);
  projection.end();
  return projection.snapshot();
}

function run(events: unknown[], profile: 'chatbot' | 'agent-chat' = 'chatbot') {
  const bridge = createBridge(profile);
  const output = events.flatMap(event => bridge.accept(event));
  output.push(...bridge.end());
  return { bridge, output, snapshot: project(output) };
}

function terminal(events: Event[]) {
  return events.filter(
    event =>
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
  );
}

describe('DifyEventBridge text-only, disconnected prototype', () => {
  it('streams repeated chatbot deltas without guessing overlap or removing history', () => {
    const { output, snapshot } = run([
      native('message', { answer: 'ha' }),
      native('message', { answer: 'ha' }),
      messageEnd(),
    ]);
    expect(output[0]).toMatchObject({
      type: EventType.RUN_STARTED,
      threadId: 'local-thread',
      runId: 'local-run',
    });
    expect(snapshot.status).toBe('succeeded');
    expect(snapshot.messages).toEqual([
      ...context.history!,
      { id: 'local-assistant', role: 'assistant', content: 'haha' },
    ]);
    expect(terminal(output)).toHaveLength(1);
    expect(
      output.filter(event => event.type === EventType.TEXT_MESSAGE_END)
    ).toHaveLength(1);
  });

  it('defers success until EOF and makes duplicate terminal signals idempotent', () => {
    const bridge = createBridge();
    const opening = bridge.accept(native('message', { answer: 'Answer' }));
    expect(bridge.accept(messageEnd())).toEqual([]);
    expect(bridge.accept(messageEnd())).toEqual([]);
    const ending = bridge.end();
    expect(project([...opening, ...ending]).status).toBe('succeeded');
    expect(bridge.end()).toEqual([]);
    expect(bridge.accept(messageEnd())).toEqual([]);
    expect(terminal(ending)).toHaveLength(1);
  });

  it.each(['Final answer', 'Corrected answer', ''])(
    'uses the agent-chat closing message as the authoritative complete answer %j',
    answer => {
      const { output, snapshot } = run(
        [
          native('agent_message', { answer: 'Final ' }),
          native('agent_message', { answer: 'answer' }),
          native('message', { answer }),
          messageEnd(),
        ],
        'agent-chat'
      );
      expect(snapshot.status).toBe('succeeded');
      expect(snapshot.messages.at(-1)?.content).toBe(answer);
      expect(
        output.filter(event => event.type === EventType.MESSAGES_SNAPSHOT)
      ).toHaveLength(1);
    }
  );

  it('also accepts legacy agent deltas ending at message_end without inventing a full answer', () => {
    const { snapshot } = run(
      [native('agent_message', { answer: 'Legacy answer' }), messageEnd()],
      'agent-chat'
    );
    expect(snapshot.status).toBe('succeeded');
    expect(snapshot.messages.at(-1)?.content).toBe('Legacy answer');
  });

  it('accepts a direct complete agent-chat reply without a workflow', () => {
    const { snapshot } = run(
      [native('message', { answer: 'Preset reply' }), messageEnd()],
      'agent-chat'
    );
    expect(snapshot.status).toBe('succeeded');
    expect(snapshot.messages.at(-1)?.content).toBe('Preset reply');
  });

  it.each(['different', 'Long', ''])(
    'replaces rather than appends the complete moderated answer %j',
    answer => {
      const { output, snapshot } = run([
        native('message', { answer: 'Long original answer' }),
        native('message_replace', { answer }),
        messageEnd(),
      ]);
      expect(snapshot.messages.at(-1)?.content).toBe(answer);
      expect(snapshot.status).toBe('succeeded');
      const replacement = output.find(
        event => event.type === EventType.MESSAGES_SNAPSHOT
      );
      expect(replacement).toMatchObject({
        messages: [
          ...context.history!,
          { id: 'local-assistant', role: 'assistant', content: answer },
        ],
      });
    }
  );

  it('allows replacement as the first content event and repeated replacements', () => {
    const { snapshot } = run([
      native('message_replace', { answer: 'First preset' }),
      native('message_replace', { answer: 'Second preset' }),
      messageEnd(),
    ]);
    expect(snapshot.status).toBe('succeeded');
    expect(snapshot.messages.at(-1)?.content).toBe('Second preset');
  });

  it('rejects multiple complete answers instead of treating legacy direct chunks as snapshots', () => {
    const { output } = run(
      [
        native('message', { answer: 'First' }),
        native('message', { answer: 'Second' }),
        messageEnd(),
      ],
      'agent-chat'
    );
    expect(terminal(output)).toEqual([
      expect.objectContaining({
        type: EventType.RUN_ERROR,
        code: 'AGENT_PROTOCOL_ERROR',
      }),
    ]);
  });

  it('does not guess agent semantics from a chatbot label', () => {
    const { snapshot } = run([
      native('agent_message', { answer: 'Answer' }),
      messageEnd(),
    ]);
    expect(snapshot.status).toBe('failed');
  });

  it('does not finish a workflow at message_end', () => {
    const { output, snapshot } = run([
      workflowStart(),
      native('message', { answer: 'Answer' }),
      messageEnd(),
    ]);
    expect(snapshot.status).toBe('unknown');
    expect(terminal(output)).toEqual([
      expect.objectContaining({ code: 'AGENT_STREAM_INCOMPLETE' }),
    ]);
  });

  it('accepts only the successful workflow plus completed chat message combination', () => {
    const { output, snapshot } = run([
      workflowStart(),
      native('message', { answer: 'Answer' }),
      messageEnd(),
      workflowFinish(),
      workflowFinish(),
    ]);
    expect(snapshot.status).toBe('succeeded');
    expect(terminal(output)).toHaveLength(1);
  });

  it.each([
    [workflowFinish()],
    [workflowStart(), workflowFinish()],
    [
      native('message', {
        answer: 'Answer',
        workflow_run_id: 'native-workflow',
      }),
      messageEnd(),
    ],
  ])(
    'does not turn an incomplete workflow sequence into successful chat',
    (...events) => {
      const { snapshot } = run(events);
      expect(snapshot.status).toBe('unknown');
    }
  );

  it.each([
    ['failed', 'AGENT_RUN_FAILED', 'failed'],
    ['partial-succeeded', 'AGENT_PARTIAL_RESULT', 'failed'],
    ['stopped', undefined, 'cancelled'],
  ])(
    'maps explicit workflow status %s without waiting for message_end',
    (status, code, expected) => {
      const { output, snapshot } = run([
        workflowStart(),
        native('message', { answer: 'Partial answer' }),
        workflowFinish(status),
        native('error', {
          status: 500,
          code: 'native_error',
          message: 'Private diagnostic',
        }),
      ]);
      expect(snapshot.status).toBe(expected);
      expect(snapshot.messages.at(-1)?.content).toBe('Partial answer');
      expect(terminal(output)).toHaveLength(1);
      if (code) expect(terminal(output)[0]).toMatchObject({ code });
      else
        expect(terminal(output)[0]).toMatchObject({
          outcome: { type: 'cancelled' },
        });
    }
  );

  it('does not report success with exceptions or a contradictory native error', () => {
    for (const extra of [
      { exceptions_count: 1 },
      { error: 'Private diagnostic' },
    ]) {
      const { snapshot } = run([
        workflowStart(),
        messageEnd(),
        workflowFinish('succeeded', extra),
      ]);
      expect(snapshot.status).not.toBe('succeeded');
    }
  });

  it('reports native errors safely, even after message_end but before EOF', () => {
    const { output, snapshot } = run([
      native('message', { answer: 'Answer' }),
      messageEnd(),
      native('error', {
        status: 500,
        code: 'native_error',
        message: 'Private diagnostic',
      }),
    ]);
    expect(snapshot.status).toBe('failed');
    expect(terminal(output)).toEqual([
      expect.objectContaining({ code: 'AGENT_RUN_FAILED' }),
    ]);
    expect(JSON.stringify(output)).not.toContain('Private diagnostic');
  });

  it.each([
    native('workflow_paused', {
      workflow_run_id: 'native-workflow',
      data: { status: 'paused', paused_nodes: ['native-node'] },
    }),
    native('human_input_required', {
      workflow_run_id: 'native-workflow',
      data: {
        form_token: 'PRIVATE_FORM_SENTINEL',
        form_content: 'PRIVATE_FORM_CONTENT',
        expiration_time: 20,
      },
    }),
    native('human_input_required', {
      workflow_run_id: 'native-workflow',
      data: {
        form_token: null,
        form_content: 'PRIVATE_FORM_CONTENT',
        expiration_time: 20,
      },
    }),
  ])('does not advertise interrupt/resume for an unsupported pause', event => {
    const { output, snapshot } = run([event]);
    expect(output[0]).toMatchObject({
      type: EventType.RUN_ERROR,
      code: 'AGENT_INTERRUPTED_UNSUPPORTED',
    });
    expect(snapshot.status).toBe('failed');
    expect(JSON.stringify(output)).not.toContain('PRIVATE_FORM');
  });

  it.each([
    [[]],
    [[{ event: 'ping' }]],
    [[native('message', { answer: 'Unfinished' })]],
  ])('treats EOF without native completion as incomplete', events => {
    const { output, snapshot } = run(events);
    expect(snapshot.status).toBe('unknown');
    expect(terminal(output)).toEqual([
      expect.objectContaining({ code: 'AGENT_STREAM_INCOMPLETE' }),
    ]);
    expect([EventType.RUN_STARTED, EventType.RUN_ERROR]).toContain(
      output[0].type
    );
  });

  it('ignores unknown extensions with a safe warning when known terminals succeed', () => {
    const { bridge, output, snapshot } = run([
      { event: 'PRIVATE_UNKNOWN_SENTINEL', secret: 'PRIVATE_DEBUG_SENTINEL' },
      native('message', { answer: 'Answer' }),
      messageEnd(),
    ]);
    expect(bridge.warnings).toEqual(['DIFY_UNKNOWN_EVENT']);
    expect(snapshot.status).toBe('succeeded');
    expect(JSON.stringify({ output, warnings: bridge.warnings })).not.toContain(
      'PRIVATE_'
    );
  });

  it('does not mistake workflow_end for the native workflow_finished discriminator', () => {
    const { bridge, snapshot } = run([
      workflowStart(),
      { event: 'workflow_end' },
      messageEnd(),
    ]);
    expect(bridge.warnings).toContain('DIFY_UNKNOWN_EVENT');
    expect(snapshot.status).toBe('unknown');
  });

  it('allows message_end after a confirmed workflow finish without inferring EOF success', () => {
    const { snapshot } = run([
      workflowStart(),
      native('message', { answer: 'Answer' }),
      workflowFinish(),
      messageEnd(),
    ]);
    expect(snapshot.status).toBe('succeeded');
  });

  it.each([
    native('agent_thought', {
      position: 1,
      thought: 'PRIVATE_THOUGHT',
      tool: 'lookup',
      tool_input: 'PRIVATE_ARGUMENTS',
      observation: 'PRIVATE_RESULT',
    }),
    native('message_file', {
      type: 'document',
      belongs_to: 'assistant',
      url: 'https://example.invalid/PRIVATE_FILE',
    }),
    native('tts_message', { audio: 'PRIVATE_AUDIO' }),
  ])(
    'warns and fails closed when this text-only profile cannot project native content',
    event => {
      const { bridge, output, snapshot } = run(
        [
          event,
          native('agent_message', { answer: 'Public answer' }),
          messageEnd(),
        ],
        'agent-chat'
      );
      expect(bridge.warnings).toContain('DIFY_UNSUPPORTED_EVENT');
      expect(snapshot.status).toBe('failed');
      expect(JSON.stringify(output)).not.toContain('PRIVATE_');
    }
  );

  it.each(['llm', 'code', 'http-request', 'knowledge-retrieval', 'tool'])(
    'does not manufacture a tool call for a %s workflow node',
    nodeType => {
      const { bridge, output, snapshot } = run([
        workflowStart(),
        native('node_started', {
          workflow_run_id: 'native-workflow',
          data: {
            id: 'native-execution',
            node_id: 'native-node',
            node_type: nodeType,
            inputs: null,
          },
        }),
        native('node_finished', {
          workflow_run_id: 'native-workflow',
          data: {
            id: 'native-execution',
            node_id: 'native-node',
            status: 'succeeded',
            inputs: null,
            error: null,
            process_data: { secret: 'PRIVATE_DEBUG_SENTINEL' },
          },
        }),
        native('message', { answer: 'Answer' }),
        messageEnd(),
        workflowFinish(),
      ]);
      expect(snapshot.status).toBe('succeeded');
      expect(bridge.warnings).toContain('DIFY_NODE_NOT_PROJECTED');
      expect(
        output.some(
          event =>
            event.type.startsWith('TOOL_CALL') ||
            event.type === EventType.ACTIVITY_SNAPSHOT
        )
      ).toBe(false);
      expect(JSON.stringify(output)).not.toContain('PRIVATE_');
    }
  );

  it('does not promote failed nodes to success without an application-specific completion policy', () => {
    const { output } = run([
      workflowStart(),
      native('node_finished', {
        workflow_run_id: 'native-workflow',
        data: {
          id: 'native-execution',
          node_id: 'native-node',
          status: 'failed',
        },
      }),
      messageEnd(),
      workflowFinish(),
    ]);
    expect(terminal(output)[0]).toMatchObject({ code: 'AGENT_PARTIAL_RESULT' });
  });

  it('keeps native IDs, debug fields and unprojected metadata outside the public stream', () => {
    const { bridge, output, snapshot } = run([
      native('message', {
        answer: 'Public answer',
        api_key: 'PRIVATE_KEY_SENTINEL',
        debug: { token: 'PRIVATE_DEBUG_SENTINEL' },
      }),
      messageEnd({
        metadata: {
          usage: { total_tokens: 3 },
          retriever_resources: [],
          private_state: 'PRIVATE_METADATA_SENTINEL',
        },
      }),
    ]);
    expect(snapshot.status).toBe('succeeded');
    expect(bridge.warnings).toContain('DIFY_METADATA_NOT_PROJECTED');
    const serialized = JSON.stringify({ output, warnings: bridge.warnings });
    for (const forbidden of [
      'PRIVATE_',
      'native-message',
      'native-task',
      'native-conversation',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each([
    null,
    [],
    { event: 1 },
    native('message', { answer: 1 }),
    native('message_replace', { answer: null }),
    messageEnd({ metadata: [] }),
    messageEnd({ metadata: { usage: { total_tokens: -1 } } }),
    native('error', {
      status: '500',
      code: 'bad',
      message: 'Private diagnostic',
    }),
    workflowFinish('invented-status'),
    { ...workflowStart(), data: { id: 'different-run' } },
    native('node_finished', {
      workflow_run_id: 'native-workflow',
      data: { id: 'execution', node_id: 'node', status: false },
    }),
  ])('turns malformed known fields into a schema-valid safe error', event => {
    const { output, snapshot } = run([event]);
    expect(output[0]).toMatchObject({
      type: EventType.RUN_ERROR,
      code: 'AGENT_PROTOCOL_ERROR',
    });
    expect(snapshot.status).toBe('failed');
    expect(terminal(output)).toHaveLength(1);
  });

  it('rejects multiple native messages instead of silently merging them', () => {
    const { output } = run([
      native('message', { answer: 'First' }),
      native('message', { answer: 'Second', message_id: 'different-message' }),
      messageEnd(),
    ]);
    expect(terminal(output)[0]).toMatchObject({ code: 'AGENT_PROTOCOL_ERROR' });
  });

  it('keeps RUN_STARTED first when the shared writer rejects oversized content atomically', () => {
    const { output, snapshot } = run([
      native('message', { answer: 'x'.repeat(512 * 1024 + 1) }),
    ]);
    expect(output[0].type).toBe(EventType.RUN_STARTED);
    expect(terminal(output)).toEqual([
      expect.objectContaining({ code: 'AGENT_PROTOCOL_ERROR' }),
    ]);
    expect(snapshot.status).toBe('failed');
    expect(snapshot.messages).toEqual(context.history);
  });

  it('uses legacy id only when message_id is absent', () => {
    const { snapshot } = run([
      native('message', { message_id: undefined, answer: 'Legacy' }),
      messageEnd({ message_id: undefined }),
    ]);
    expect(snapshot.status).toBe('succeeded');
    expect(snapshot.messages.at(-1)?.id).toBe('local-assistant');
  });

  it('rejects a local assistant ID that collides with trusted history', () => {
    expect(
      () =>
        new DifyEventBridge({
          context,
          profile: 'chatbot',
          assistantMessageId: 'previous-assistant',
        })
    ).toThrow(AgentProtocolError);
  });
});
