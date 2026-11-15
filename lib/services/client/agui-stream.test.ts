/** @jest-environment node */
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
