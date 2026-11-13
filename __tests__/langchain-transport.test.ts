/** @jest-environment node */
import {
  type AGUIEvent,
  LangChainUpstreamError,
  parseAGUIStream,
} from '../apps/api/src/lib/langchain/ag-ui';
import {
  createThread,
  getCapabilities,
  getRun,
  streamTurn,
} from '../apps/api/src/lib/langchain/transport';

const identity = { threadId: 'thread-1', runId: 'correlation-1' };
const started = { type: 'RUN_STARTED', ...identity };
const nativeRun = {
  type: 'CUSTOM',
  name: 'native_run',
  value: { run_id: 'native-1' },
};
const finished = { type: 'RUN_FINISHED', ...identity };
const textStart = {
  type: 'TEXT_MESSAGE_START',
  messageId: 'message-1',
  role: 'assistant',
};
const textEnd = { type: 'TEXT_MESSAGE_END', messageId: 'message-1' };
const config = {
  baseUrl: 'https://agent.example.test/root/',
  apiKey: 'synthetic-service-token',
};
const turn = { ...identity, messageId: 'input-1', content: 'Hello' };

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const item of source) output.push(item);
  return output;
}

function bytesStream(input: string, fragmentSize = 10000000) {
  const bytes = new TextEncoder().encode(input);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += fragmentSize) {
        controller.enqueue(bytes.slice(offset, offset + fragmentSize));
      }
      controller.close();
    },
  });
}

function sse(events: unknown[], separator = '\n') {
  return events
    .map(event => `event: ignored${separator}data: ${JSON.stringify(event)}`)
    .join(`${separator}${separator}`)
    .concat(`${separator}${separator}`);
}

function parse(events: unknown[]) {
  return collect(parseAGUIStream(bytesStream(sse(events)), identity));
}

describe('bounded AG-UI parser', () => {
  it.each(['\n', '\r\n', '\r'])(
    'handles one-byte UTF-8 and %j line fragmentation using data.type',
    async separator => {
      const content = {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'message-1',
        delta: '\u4f60\u597d\ud83c\udf38',
        reasoning: 'private thought must not leave transport',
      };
      const events = [
        started,
        nativeRun,
        textStart,
        content,
        textEnd,
        finished,
      ];
      const result = await collect(
        parseAGUIStream(bytesStream(sse(events, separator), 1), identity)
      );
      expect(result).toEqual([
        started,
        nativeRun,
        textStart,
        {
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: 'message-1',
          delta: '\u4f60\u597d\ud83c\udf38',
        },
        textEnd,
        finished,
      ]);
    }
  );

  it('supports multiline data, comments, BOM and distinct native run identity', async () => {
    const input =
      '\ufeff: heartbeat\n\nid: ignored\nevent: not-the-type\n' +
      'data: {"type":"RUN_STARTED",\ndata: "threadId":"thread-1","runId":"correlation-1"}\n\n' +
      sse([nativeRun, finished]);
    expect(
      await collect(parseAGUIStream(bytesStream(input, 3), identity))
    ).toEqual([started, nativeRun, finished]);
  });

  it('emits only safe tool metadata, never arguments, raw result or custom debug', async () => {
    const result = await parse([
      started,
      nativeRun,
      { type: 'CUSTOM', name: 'debug', value: { secret: 'private-debug' } },
      {
        type: 'TOOL_CALL_START',
        toolCallId: 'tool-1',
        toolCallName: 'arithmetic',
        parentMessageId: 'tool-message-1',
        debug: 'private-debug',
      },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'tool-1', delta: 'private-args' },
      { type: 'TOOL_CALL_END', toolCallId: 'tool-1' },
      {
        type: 'TOOL_CALL_RESULT',
        toolCallId: 'tool-1',
        messageId: 'tool-result-1',
        role: 'tool',
        content: 'private-tool-result',
      },
      finished,
    ]);
    expect(result).toContainEqual({
      type: 'TOOL_CALL_ARGS',
      toolCallId: 'tool-1',
    });
    expect(result).toContainEqual({
      type: 'TOOL_CALL_RESULT',
      toolCallId: 'tool-1',
      messageId: 'tool-result-1',
      role: 'tool',
      content: 'Tool result received.',
    });
    expect(JSON.stringify(result)).not.toMatch(/private-/);
  });

  it.each([
    ['MODEL_TIMEOUT', 'MODEL_TIMEOUT', 'The model request timed out.'],
    ['AGENT_RUN_FAILED', 'AGENT_RUN_FAILED', 'The agent run failed.'],
    [
      'private-error',
      'RUN_INCOMPLETE',
      'The agent run could not be confirmed.',
    ],
    ['__proto__', 'RUN_INCOMPLETE', 'The agent run could not be confirmed.'],
    [undefined, 'RUN_INCOMPLETE', 'The agent run could not be confirmed.'],
  ])('sanitizes error %s', async (code, safeCode, message) => {
    const result = await parse([
      started,
      textStart,
      { type: 'RUN_ERROR', code, message: 'Bearer private-credential' },
    ]);
    expect(result.at(-1)).toEqual({
      type: 'RUN_ERROR',
      code: safeCode,
      message,
    });
    expect(JSON.stringify(result)).not.toContain('private-credential');
  });

  it.each([
    [{ ...started, threadId: 'other' }],
    [started, started],
    [nativeRun],
    [started, nativeRun, { ...finished, runId: 'native-1' }],
    [started, nativeRun, finished, finished],
    [
      started,
      nativeRun,
      finished,
      { type: 'RUN_ERROR', code: 'MODEL_TIMEOUT' },
    ],
    [started, { type: 'RUN_ERROR' }, finished],
    [started, nativeRun, nativeRun],
    [started, finished],
    [started, nativeRun, textStart, finished],
    [started, nativeRun, textEnd],
    [started, nativeRun, { ...textStart, role: 'system' }],
    [started, nativeRun, textStart, textEnd, textEnd],
    [started, nativeRun, { type: 'STATE_SNAPSHOT', snapshot: {} }],
    [started, { type: 'TOOL_CALL_END', toolCallId: 'unknown' }],
    [
      started,
      { type: 'TOOL_CALL_START', toolCallId: 'tool', toolCallName: '\n' },
    ],
  ])('rejects invalid identity or event sequence %#', async (...events) => {
    await expect(parse(events)).rejects.toMatchObject({
      code: 'UPSTREAM_PROTOCOL_ERROR',
    });
  });

  it('does not report text end as success or release a premature terminal', async () => {
    const observed: AGUIEvent[] = [];
    await expect(
      (async () => {
        for await (const event of parseAGUIStream(
          bytesStream(sse([started, nativeRun, textStart, textEnd])),
          identity
        )) {
          observed.push(event);
        }
      })()
    ).rejects.toMatchObject({ code: 'UPSTREAM_INCOMPLETE' });
    expect(observed.some(event => event.type === 'RUN_FINISHED')).toBe(false);
    const terminalEvents: AGUIEvent[] = [];
    await expect(
      (async () => {
        for await (const event of parseAGUIStream(
          bytesStream(sse([started, nativeRun, finished, finished])),
          identity
        )) {
          terminalEvents.push(event);
        }
      })()
    ).rejects.toMatchObject({ code: 'UPSTREAM_PROTOCOL_ERROR' });
    expect(terminalEvents.some(event => event.type === 'RUN_FINISHED')).toBe(
      false
    );
  });

  it('accepts an explicit object-shaped success outcome', async () => {
    expect(
      await parse([
        started,
        nativeRun,
        { ...finished, outcome: { type: 'success' } },
      ])
    ).toEqual([started, nativeRun, finished]);
  });

  it.each([
    { outcome: { type: 'interrupt', interrupts: [{ id: 'interrupt-1' }] } },
    { outcome: { type: 'cancel' } },
    { outcome: { type: 'cancelled' } },
    { outcome: { type: 'unknown' } },
    { outcome: {} },
    { outcome: null },
    { outcome: 'success' },
    { outcome: 'interrupt' },
    { outcome: 'cancel' },
    { outcome: [] },
    { outcome: 1 },
  ])(
    'never reports unsupported outcome $outcome as success',
    async ({ outcome }) => {
      const observed: AGUIEvent[] = [];
      await expect(
        (async () => {
          for await (const event of parseAGUIStream(
            bytesStream(sse([started, nativeRun, { ...finished, outcome }])),
            identity
          )) {
            observed.push(event);
          }
        })()
      ).rejects.toMatchObject({ code: 'UPSTREAM_PROTOCOL_ERROR' });
      expect(observed.some(event => event.type === 'RUN_FINISHED')).toBe(false);
    }
  );

  it.each(['data: not-json\n\n', 'data: []\n\n', 'data: null\n\n'])(
    'rejects malformed payload %j without leaking its contents',
    async input => {
      await expect(
        collect(parseAGUIStream(bytesStream(input), identity))
      ).rejects.toMatchObject({
        code: 'UPSTREAM_PROTOCOL_ERROR',
        message: 'UPSTREAM_PROTOCOL_ERROR',
      });
    }
  );

  it('rejects invalid UTF-8, unterminated SSE frames and oversized events', async () => {
    const invalid = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff]));
        controller.close();
      },
    });
    await expect(
      collect(parseAGUIStream(invalid, identity))
    ).rejects.toMatchObject({ code: 'UPSTREAM_PROTOCOL_ERROR' });
    await expect(
      collect(parseAGUIStream(bytesStream('data: {}'), identity))
    ).rejects.toMatchObject({ code: 'UPSTREAM_INCOMPLETE' });
    await expect(
      collect(
        parseAGUIStream(bytesStream('x'.repeat(256 * 1024 + 1)), identity)
      )
    ).rejects.toMatchObject({ code: 'UPSTREAM_PROTOCOL_ERROR' });
  });

  it('cancels the reader when a consumer stops early', async () => {
    const cancel = jest.fn();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse([started])));
      },
      cancel,
    });
    for await (const event of parseAGUIStream(source, identity)) {
      expect(event).toEqual(started);
      break;
    }
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(source.locked).toBe(false);
  });
});

describe('LangChain upstream transport', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('creates a server-generated thread with Bearer authentication and no metadata', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        thread_id: 'thread-1',
        metadata: { owner: 'private-owner' },
      })
    );
    expect(await createThread(config)).toEqual({ threadId: 'thread-1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://agent.example.test/root/threads',
      expect.objectContaining({
        method: 'POST',
        body: '{}',
        headers: expect.objectContaining({
          Authorization: 'Bearer synthetic-service-token',
        }),
        redirect: 'error',
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('queries native run identity and returns no debug metadata', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        thread_id: 'thread-1',
        run_id: 'native-1',
        status: 'success',
        metadata: { reasoning: 'private' },
      })
    );
    expect(await getRun(config, 'thread-1', 'native-1')).toEqual({
      threadId: 'thread-1',
      runId: 'native-1',
      status: 'success',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://agent.example.test/root/threads/thread-1/runs/native-1'
    );
    fetchMock.mockResolvedValue(
      Response.json({
        thread_id: 'other',
        run_id: 'native-1',
        status: 'success',
      })
    );
    await expect(getRun(config, 'thread-1', 'native-1')).rejects.toMatchObject({
      code: 'UPSTREAM_PROTOCOL_ERROR',
    });
  });

  it('submits exactly one new text input and preserves separate native identity', async () => {
    fetchMock.mockResolvedValue(
      new Response(sse([started, nativeRun, finished]), {
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      })
    );
    expect(await collect(streamTurn(config, turn))).toEqual([
      started,
      nativeRun,
      finished,
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://agent.example.test/root/ag-ui');
    expect(JSON.parse(init.body)).toEqual({
      ...identity,
      messages: [{ id: 'input-1', role: 'user', content: 'Hello' }],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('authenticates capability queries and refuses an explicitly mismatched assistant', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ assistant_id: 'configured-agent', debug: 'private' })
    );
    expect(await getCapabilities(config)).toEqual({
      assistantId: 'configured-agent',
    });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer synthetic-service-token'
    );
    await expect(
      collect(streamTurn({ ...config, assistantId: 'wrong-agent' }, turn))
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(
      fetchMock.mock.calls.every(call => call[0].endsWith('/capabilities'))
    ).toBe(true);
  });

  it('checks an explicit matching assistant without adding unsupported request fields', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ assistant_id: 'configured-agent' })
      )
      .mockResolvedValueOnce(
        new Response(sse([started, nativeRun, finished]), {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );
    await collect(
      streamTurn({ ...config, assistantId: 'configured-agent' }, turn)
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty(
      'assistant_id'
    );
  });

  it.each([
    { ...turn, content: 'a'.repeat(16001) },
    { ...turn, content: '\u0000'.repeat(12000) },
    { ...turn, content: '' },
    { ...turn, messageId: '../other' },
  ])(
    'rejects invalid or oversized turn %# before issuing a request',
    async input => {
      await expect(collect(streamTurn(config, input))).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    { ...config, baseUrl: 'https://private:credential@agent.example.test' },
    { ...config, baseUrl: 'https://agent.example.test?secret=private' },
    { ...config, baseUrl: 'file:///private' },
    { ...config, apiKey: 'value\r\nInjected: yes' },
  ])('rejects unsafe connection configuration %#', async input => {
    await expect(createThread(input)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never retries thread creation or generation on HTTP or network failure', async () => {
    fetchMock.mockResolvedValue(
      new Response('private upstream error', { status: 503 })
    );
    await expect(createThread(config)).rejects.toMatchObject({
      code: 'UPSTREAM_HTTP_ERROR',
      status: 503,
      message: 'UPSTREAM_HTTP_ERROR',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock
      .mockClear()
      .mockRejectedValue(new Error('private-transport-error'));
    await expect(collect(streamTurn(config, turn))).rejects.toEqual(
      new LangChainUpstreamError('UPSTREAM_UNAVAILABLE')
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not accept a JSON 200 response as a stream or malformed run data', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true }));
    await expect(collect(streamTurn(config, turn))).rejects.toMatchObject({
      code: 'UPSTREAM_PROTOCOL_ERROR',
    });
    await expect(createThread(config)).rejects.toMatchObject({
      code: 'UPSTREAM_PROTOCOL_ERROR',
    });
  });

  it('aborts stalled JSON reads at the total deadline and releases resources', async () => {
    jest.useFakeTimers();
    const cancel = jest.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = expect(createThread(config)).rejects.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
    });
    await jest.advanceTimersByTimeAsync(15001);
    await pending;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('times out an unfinished stream, not merely the response headers', async () => {
    jest.useFakeTimers();
    const cancel = jest.fn();
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sse([started])));
          },
          cancel,
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
    );
    const pending = expect(
      collect(streamTurn(config, turn))
    ).rejects.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
    });
    await jest.advanceTimersByTimeAsync(150001);
    await pending;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('handles caller abort as connection abort, without requesting execution cancellation', async () => {
    const controller = new AbortController();
    const cancel = jest.fn();
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );
    const pending = expect(
      collect(streamTurn(config, { ...turn, signal: controller.signal }))
    ).rejects.toMatchObject({ code: 'UPSTREAM_ABORTED' });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await pending;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).not.toContain('/cancel');
  });

  it('does not start a request when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createThread(config, controller.signal)).rejects.toMatchObject(
      {
        code: 'UPSTREAM_ABORTED',
      }
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
