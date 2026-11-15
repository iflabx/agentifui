/** @jest-environment node */
import type { AgentApp } from '../agent-app';
import {
  DifyChatIdentity,
  parseDifyRuntimeStream,
  streamDifyChatbot,
} from './dify-transport';

const { ReadableStream: Stream } = jest.requireActual('node:stream/web');

async function collect(parts: Uint8Array[]) {
  const stream = new Stream({
    start(controller: ReadableStreamDefaultController<Uint8Array>) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
  const values = [];
  for await (const event of parseDifyRuntimeStream(
    stream,
    new AbortController().signal
  ))
    values.push(event);
  return values;
}

it('parses CR, LF, split CRLF, multiline data and split UTF-8 without using SSE id as a native identity', async () => {
  const value = Buffer.from(
    ': comment\r\nid: ignored\r\ndata: {"event":"message",\r\ndata: "answer":"\u4f60\u597d"}\r\n\r\n'
  );
  const parts = [...value].map(byte => Uint8Array.of(byte));
  expect(await collect(parts)).toEqual([
    { event: 'message', answer: '\u4f60\u597d' },
  ]);
});

it.each([
  'data: {"event":"message"}',
  'data: {"event":"message"}\n',
  'data: [DONE]\n\n',
  'data: []\n\n',
  'data: {"answer":"no event"}\n\n',
  `data: ${'x'.repeat(256 * 1024)}\n\n`,
])(
  'rejects malformed or incomplete framing rather than accepting it as EOF',
  async value => {
    await expect(collect([Buffer.from(value)])).rejects.toMatchObject({
      code: expect.stringMatching(/^DIFY_STREAM_/),
    });
  }
);

it('rejects malformed UTF-8 and enforces a total stream bound even for comments', async () => {
  await expect(collect([Uint8Array.of(255)])).rejects.toThrow();
  await expect(
    collect(
      Array.from({ length: 33 }, () => Buffer.from(`:${'x'.repeat(65534)}\n`))
    )
  ).rejects.toMatchObject({ code: 'DIFY_STREAM_LIMIT' });
});

it('binds only whitelisted text events and verifies every supplied private identity before projection', () => {
  const identity = new DifyChatIdentity(null);
  expect(
    identity.accept({
      event: 'extension',
      conversation_id: 'untrusted',
      message_id: 'untrusted',
    })
  ).toEqual({ conversationId: null, messageId: undefined });
  expect(
    identity.accept({
      event: 'message',
      conversation_id: 'thread',
      message_id: 'message',
      task_id: 'task',
    })
  ).toEqual({ conversationId: 'thread', messageId: 'message' });
  for (const patch of [
    { conversation_id: 'other' },
    { message_id: 'other' },
    { task_id: 'other' },
    { id: 'other' },
    { conversation_id: '' },
  ]) {
    expect(() =>
      identity.accept({
        event: 'message_end',
        conversation_id: 'thread',
        message_id: 'message',
        task_id: 'task',
        ...patch,
      })
    ).toThrow();
  }
});

it('never accepts a native thread other than the previously trusted binding', () => {
  const identity = new DifyChatIdentity('expected');
  expect(() =>
    identity.accept({
      event: 'message',
      conversation_id: 'stolen',
      message_id: 'message',
    })
  ).toThrow('DIFY_IDENTITY_CHANGED');
  expect(() =>
    identity.accept({ event: 'message', message_id: 'message' })
  ).toThrow('DIFY_IDENTITY_CHANGED');
});

it('starts the native request deadline only after admission completes', async () => {
  jest.useFakeTimers();
  const originalFetch = global.fetch;
  const onDispatch = jest.fn();
  let release!: () => void;
  const admission = new Promise<void>(resolve => {
    release = resolve;
  });
  const upstream = jest.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.signal?.aborted).toBe(false);
    return {
      ok: true,
      headers: { get: () => 'text/event-stream' },
      body: new Stream({
        start(controller: ReadableStreamDefaultController<Uint8Array>) {
          controller.enqueue(Buffer.from('data: {"event":"ping"}\n\n'));
          controller.close();
        },
      }),
    } as unknown as Response;
  });
  global.fetch = upstream;
  const stream = streamDifyChatbot({
    app: {
      baseUrl: 'https://example.invalid',
      apiKey: 'synthetic-service-token',
    } as AgentApp,
    userId: 'synthetic-user',
    content: 'hello',
    inputs: {},
    nativeConversationId: null,
    beforeDispatch: () => admission,
    onDispatch,
  });
  try {
    const first = stream.next();
    await jest.advanceTimersByTimeAsync(150001);
    expect(onDispatch).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
    release();
    await expect(first).resolves.toMatchObject({
      done: false,
      value: { event: 'ping' },
    });
    await expect(stream.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await stream.return(undefined);
    global.fetch = originalFetch;
    jest.useRealTimers();
  }
});

it('still terminates a stalled native stream after the post-admission deadline', async () => {
  jest.useFakeTimers();
  const originalFetch = global.fetch;
  global.fetch = jest.fn(
    async () =>
      ({
        ok: true,
        headers: { get: () => 'text/event-stream' },
        body: new Stream({
          start(controller: ReadableStreamDefaultController<Uint8Array>) {
            controller.enqueue(Buffer.from('data: {"event":"ping"}\n\n'));
          },
        }),
      }) as unknown as Response
  );
  const stream = streamDifyChatbot({
    app: {
      baseUrl: 'https://example.invalid',
      apiKey: 'synthetic-service-token',
    } as AgentApp,
    userId: 'synthetic-user',
    content: 'hello',
    inputs: {},
    nativeConversationId: null,
    beforeDispatch: async () => undefined,
    onDispatch: () => undefined,
  });
  try {
    await expect(stream.next()).resolves.toMatchObject({
      value: { event: 'ping' },
    });
    const timeout = expect(stream.next()).rejects.toMatchObject({
      code: 'DIFY_UPSTREAM_TIMEOUT',
    });
    await jest.advanceTimersByTimeAsync(150001);
    await timeout;
  } finally {
    await stream.return(undefined);
    global.fetch = originalFetch;
    jest.useRealTimers();
  }
});
