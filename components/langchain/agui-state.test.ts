/** @jest-environment node */
import {
  AGUI_TOOL_SUMMARY,
  type AgentProjectionSnapshot,
} from '../../packages/shared/src/agui';
import {
  projectAgentView,
  recoverAgentRun,
  restoreAgentView,
} from './agui-state';
import { agentTimeline } from './state';

const snapshot: AgentProjectionSnapshot = {
  schemaVersion: 2,
  threadId: 'thread',
  runId: 'run',
  status: 'succeeded',
  warnings: [],
  messages: [
    { id: 'user', role: 'user', content: 'Question' },
    {
      id: 'tool',
      role: 'activity',
      activityType: AGUI_TOOL_SUMMARY,
      content: { name: 'lookup', status: 'completed' },
    },
    { id: 'answer', role: 'assistant', content: 'Answer' },
  ],
  outputMessageIds: ['tool', 'answer'],
};

it.each(['pending', 'failed', 'saved'])(
  'keeps an earlier tool-only turn before the next user message in live and %s history',
  persistenceStatus => {
    const first: AgentProjectionSnapshot = {
      ...snapshot,
      messages: snapshot.messages.slice(0, 2),
      outputMessageIds: ['tool'],
    };
    const second: AgentProjectionSnapshot = {
      ...snapshot,
      runId: 'second-run',
      messages: [
        ...first.messages,
        { id: 'second-user', role: 'user', content: 'Next question' },
        { id: 'second-answer', role: 'assistant', content: 'Next answer' },
      ],
      outputMessageIds: ['second-answer'],
    };
    const initial = projectAgentView({ messages: [], tools: [] }, first);
    const live = projectAgentView(initial, second);
    const displayIds = (view: ReturnType<typeof projectAgentView>) =>
      agentTimeline(view).map(item =>
        item.type === 'message' ? item.message.id : item.tool.toolCallId
      );
    expect(initial.messages.map(message => message.role)).toEqual(['user']);
    expect(displayIds(live)).toEqual([
      'user',
      'tool',
      'second-user',
      'second-answer',
    ]);
    const restored = restoreAgentView({
      conversationId: 'thread',
      messages: live.messages,
      runs: [
        {
          id: 'second-run',
          executionStatus: 'success',
          persistenceStatus: 'saved',
          agui: second,
        },
        {
          id: 'run',
          executionStatus: 'success',
          persistenceStatus,
          agui: first,
        },
      ],
    });
    expect(displayIds(restored)).toEqual(displayIds(live));
    expect(restored.messages).toHaveLength(3);
  }
);

it('preserves multiple tool-only turns and repeated snapshots without inventing assistant placeholders', () => {
  const first = {
    ...snapshot,
    messages: snapshot.messages.slice(0, 2),
    outputMessageIds: ['tool'],
  };
  const second: AgentProjectionSnapshot = {
    ...snapshot,
    runId: 'second-run',
    messages: [
      ...first.messages,
      { id: 'second-user', role: 'user', content: 'Next' },
      {
        id: 'second-tool',
        role: 'activity',
        activityType: AGUI_TOOL_SUMMARY,
        content: { name: 'search', status: 'completed' },
      },
    ],
    outputMessageIds: ['second-tool'],
  };
  const live = projectAgentView(
    projectAgentView({ messages: [], tools: [] }, first),
    second
  );
  const repeated = projectAgentView(live, second);
  expect(
    agentTimeline(repeated).map(item =>
      item.type === 'message' ? item.message.id : item.tool.toolCallId
    )
  ).toEqual(['user', 'tool', 'second-user', 'second-tool']);
  expect(repeated.messages.every(message => message.role === 'user')).toBe(
    true
  );
  expect(repeated.tools).toHaveLength(2);
});

it('uses canonical content and inert tool summaries while leaving persistence pending', () => {
  const view = projectAgentView({ messages: [], tools: [] }, snapshot);
  expect(view.messages.map(message => message.content)).toEqual([
    'Question',
    'Answer',
  ]);
  expect(view.tools).toEqual([
    {
      toolCallId: 'tool',
      name: 'lookup',
      status: 'completed',
      runId: 'run',
      order: 1,
      afterMessageId: 'user',
    },
  ]);
  expect(view.run).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'pending',
  });
  expect(projectAgentView(view, snapshot).tools).toHaveLength(1);
});

it.each(['pending', 'failed', 'saved'])(
  'restores current output scope and tool order for %s storage',
  persistenceStatus => {
    const materialized = [
      { id: 'user', role: 'user', content: 'Question' },
      ...(persistenceStatus === 'saved'
        ? [
            {
              id: 'answer',
              role: 'assistant',
              content: 'Authoritative materialized answer',
            },
          ]
        : []),
    ];
    const view = restoreAgentView({
      conversationId: 'thread',
      messages: materialized,
      runs: [
        {
          id: 'run',
          executionStatus: 'success',
          persistenceStatus,
          agui: snapshot,
        },
      ],
    });
    expect(view.messages).toHaveLength(2);
    expect(view.messages.at(-1)?.content).toBe(
      persistenceStatus === 'saved'
        ? 'Authoritative materialized answer'
        : 'Answer'
    );
    expect(view.tools).toHaveLength(1);
    expect(view.run?.persistenceStatus).toBe(persistenceStatus);
  }
);

it('does not resurrect old text or activities from a run outside the current history page', () => {
  const view = restoreAgentView({
    conversationId: 'thread',
    messages: [{ id: 'other', role: 'user', content: 'Different page' }],
    runs: [
      {
        id: 'run',
        executionStatus: 'success',
        persistenceStatus: 'saved',
        agui: snapshot,
      },
    ],
  });
  expect(view.messages.map(message => message.id)).toEqual(['other']);
  expect(view.tools).toEqual([]);
});

it('keeps stable projection ordinals when one run spans history pages', () => {
  const projection: AgentProjectionSnapshot = {
    ...snapshot,
    messages: [
      snapshot.messages[0],
      { id: 'first', role: 'assistant', content: 'First' },
      snapshot.messages[1],
      { id: 'second', role: 'assistant', content: 'Second' },
    ],
    outputMessageIds: ['first', 'tool', 'second'],
  };
  const run = {
    id: 'run',
    executionStatus: 'success',
    persistenceStatus: 'saved',
    agui: projection,
  };
  const older = restoreAgentView({
    conversationId: 'thread',
    messages: [{ id: 'first', role: 'assistant', content: 'First' }],
    runs: [run],
  });
  const newer = restoreAgentView({
    conversationId: 'thread',
    messages: [{ id: 'second', role: 'assistant', content: 'Second' }],
    runs: [run],
  });
  const timeline = agentTimeline({
    ...newer,
    messages: [...older.messages, ...newer.messages],
    tools: [...older.tools, ...newer.tools],
  });
  expect(
    timeline.map(item =>
      item.type === 'message' ? item.message.id : item.tool.toolCallId
    )
  ).toEqual(['first', 'tool', 'second']);
});

it('keeps AG-UI activities from current and historical runs during empty recovery polling', () => {
  const previous = projectAgentView(
    {
      messages: [],
      tools: [
        {
          runId: 'old',
          toolCallId: 'old-tool',
          name: 'old',
          status: 'completed',
        },
      ],
    },
    snapshot
  );
  const recovered = recoverAgentRun(previous, {
    id: 'run',
    executionStatus: 'success',
    persistenceStatus: 'failed',
    recoveryMessages: [],
    agui: snapshot,
  });
  expect(recovered.tools.map(tool => tool.toolCallId)).toEqual([
    'old-tool',
    'tool',
  ]);
  expect(recovered.messages.map(message => message.id)).toEqual([
    'user',
    'answer',
  ]);
});

it.each([undefined, []])(
  'does not erase known activities when a status response lacks a projection (%p)',
  recoveryMessages => {
    const previous = projectAgentView(
      {
        messages: [],
        tools: [
          {
            runId: 'old',
            toolCallId: 'old-tool',
            name: 'old',
            status: 'completed',
          },
        ],
      },
      snapshot
    );
    const recovered = recoverAgentRun(previous, {
      id: 'run',
      executionStatus: 'unknown',
      persistenceStatus: 'failed',
      recoveryMessages,
    });
    expect(recovered.tools).toEqual(previous.tools);
    expect(recovered.messages).toEqual(previous.messages);
  }
);
