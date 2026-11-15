/** @jest-environment node */
import { projectAgentView } from '../../../components/langchain/agui-state';
import { consumeAguiStream } from './agui-stream';

const start = {
  type: 'RUN_STARTED',
  protocolVersion: '1.0',
  threadId: 'thread',
  runId: 'run',
  metadata: {
    'agentifui.acceptance.v1': {
      submissionId: 'submission',
      userMessageId: 'question',
    },
  },
};
const finish = {
  type: 'RUN_FINISHED',
  threadId: 'thread',
  runId: 'run',
  outcome: { type: 'success' },
};
const history = () => [
  { id: 'question', role: 'user' as const, content: 'Hello' },
];

function response(events: unknown[], separator = '\n', trailing = '') {
  const bytes = new TextEncoder().encode(
    events
      .map(event => `data: ${JSON.stringify(event)}${separator}${separator}`)
      .join('') + trailing
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
    { headers: { 'x-agentifui-protocol': 'ag-ui/1.0' } }
  );
}

it.each(['\n', '\r', '\r\n'])(
  'projects fragmented UTF-8 and %j framing through the shared contract',
  async separator => {
    const accept = jest.fn();
    await consumeAguiStream(
      response(
        [
          start,
          {
            type: 'TEXT_MESSAGE_START',
            messageId: 'answer',
            role: 'assistant',
          },
          {
            type: 'TEXT_MESSAGE_CONTENT',
            messageId: 'answer',
            delta: '\u4f60\u597d',
          },
          { type: 'TEXT_MESSAGE_END', messageId: 'answer' },
          finish,
        ],
        separator
      ),
      { submissionId: 'submission', history, accept }
    );
    expect(accept.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'succeeded',
      outputMessageIds: ['answer'],
      messages: [
        history()[0],
        { id: 'answer', role: 'assistant', content: '\u4f60\u597d' },
      ],
    });
  }
);

it('replaces a full snapshot without duplicating the incremental answer and keeps save state out of execution events', async () => {
  const accept = jest.fn();
  await consumeAguiStream(
    response([
      start,
      { type: 'TEXT_MESSAGE_START', messageId: 'answer' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'answer', delta: 'Draft' },
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [
          ...history(),
          { id: 'answer', role: 'assistant', content: 'Replacement' },
        ],
      },
      { type: 'TEXT_MESSAGE_END', messageId: 'answer' },
      finish,
    ]),
    { submissionId: 'submission', history, accept }
  );
  const state = accept.mock.calls.at(-1)?.[0];
  expect(
    state.messages.filter((message: { id: string }) => message.id === 'answer')
  ).toEqual([{ id: 'answer', role: 'assistant', content: 'Replacement' }]);
  expect(state).not.toHaveProperty('persistenceStatus');
});

it('does not claim unloaded older snapshot messages as outputs of the current paginated turn', async () => {
  const accept = jest.fn();
  await consumeAguiStream(
    response([
      start,
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [
          {
            id: 'older-user',
            role: 'user',
            content: 'Older question outside this page',
          },
          {
            id: 'older-answer',
            role: 'assistant',
            content: 'Older answer outside this page',
          },
          {
            id: 'older-activity',
            role: 'activity',
            activityType: 'agentifui.tool-summary.v1',
            content: { name: 'older-tool', status: 'completed' },
          },
          ...history(),
          { id: 'answer', role: 'assistant', content: 'Current replacement' },
        ],
      },
      finish,
    ]),
    { submissionId: 'submission', history, accept }
  );
  const snapshot = accept.mock.calls.at(-1)?.[0];
  expect(snapshot.outputMessageIds).toEqual(['answer']);
  expect(
    snapshot.messages.map((message: { id: string }) => message.id)
  ).toEqual(['question', 'answer']);
  const view = projectAgentView({ messages: [], tools: [] }, snapshot);
  expect(
    view.messages.find(message => message.id === 'older-answer')?.metadata
      ?.backend_run_id
  ).toBeUndefined();
  expect(
    view.messages.find(message => message.id === 'answer')?.metadata
      ?.backend_run_id
  ).toBe('run');
  expect(view.tools).toEqual([]);
});

it('keeps the loaded page and current incremental output across full replacements', async () => {
  const accept = jest.fn();
  const loaded = [
    { id: 'loaded-user', role: 'user' as const, content: 'Loaded question' },
    {
      id: 'loaded-answer',
      role: 'assistant' as const,
      content: 'Loaded answer',
    },
    ...history(),
  ];
  await consumeAguiStream(
    response([
      start,
      { type: 'TEXT_MESSAGE_START', messageId: 'answer' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'answer', delta: 'Draft' },
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [
          { id: 'unloaded-answer', role: 'assistant', content: 'Unloaded' },
          ...loaded,
          { id: 'answer', role: 'assistant', content: 'Replacement' },
        ],
      },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'answer', delta: ' complete' },
      { type: 'TEXT_MESSAGE_END', messageId: 'answer' },
      finish,
    ]),
    { submissionId: 'submission', history: () => loaded, accept }
  );
  const snapshot = accept.mock.calls.at(-1)?.[0];
  expect(snapshot.messages).toEqual([
    ...loaded,
    { id: 'answer', role: 'assistant', content: 'Replacement complete' },
  ]);
  expect(snapshot.outputMessageIds).toEqual(['answer']);
});

it('does not accept a replacement that loses its trusted current user boundary', async () => {
  await expect(
    consumeAguiStream(
      response([
        start,
        {
          type: 'MESSAGES_SNAPSHOT',
          messages: [
            { id: 'answer', role: 'assistant', content: 'Unassociated' },
          ],
        },
        finish,
      ]),
      { submissionId: 'submission', history, accept: jest.fn() }
    )
  ).rejects.toThrow('AGENT_RUN_INPUT_MISSING');
});

it('marks EOF without a terminal unknown instead of inventing success', async () => {
  const accept = jest.fn();
  await consumeAguiStream(response([start]), {
    submissionId: 'submission',
    history,
    accept,
  });
  expect(accept.mock.calls.at(-1)?.[0].status).toBe('unknown');
});

it.each([
  [{ ...start, threadId: 'wrong' }, 'AGENT_RUN_ID_MISMATCH'],
  [{ ...start, metadata: {} }, 'AGENT_RUN_ID_MISMATCH'],
  [
    {
      ...start,
      metadata: {
        'agentifui.acceptance.v1': {
          submissionId: 'other',
          userMessageId: 'question',
        },
      },
    },
    'AGENT_RUN_ID_MISMATCH',
  ],
  [
    { type: 'TEXT_MESSAGE_START', messageId: 'answer' },
    'AGENT_RUN_START_REQUIRED',
  ],
])(
  'rejects uncorrelated or premature events without accepting a task',
  async (event, code) => {
    const accept = jest.fn();
    await expect(
      consumeAguiStream(response([event]), {
        submissionId: 'submission',
        conversationId: 'thread',
        history,
        accept,
      })
    ).rejects.toThrow(code);
    expect(accept).not.toHaveBeenCalled();
  }
);

it('refuses truncated frames, malformed UTF-8 and a missing negotiated header', async () => {
  await expect(
    consumeAguiStream(response([start], '\n', 'data: {'), {
      submissionId: 'submission',
      history,
      accept: jest.fn(),
    })
  ).rejects.toThrow('AGENT_STREAM_INCOMPLETE');
  await expect(
    consumeAguiStream(
      new Response(Uint8Array.of(255), {
        headers: { 'x-agentifui-protocol': 'ag-ui/1.0' },
      }),
      { submissionId: 'submission', history, accept: jest.fn() }
    )
  ).rejects.toThrow();
  await expect(
    consumeAguiStream(new Response(''), {
      submissionId: 'submission',
      history,
      accept: jest.fn(),
    })
  ).rejects.toThrow('AGENT_PROTOCOL_UNSUPPORTED');
});
