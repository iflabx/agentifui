/** @jest-environment node */
import { ReadableStream } from 'node:stream/web';
import { TextDecoder, TextEncoder } from 'node:util';

import { parseSseStream } from './sse-parser';

global.TextDecoder = TextDecoder as typeof global.TextDecoder;

function createStream(text: string, chunkSize = 7) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
      }
      controller.close();
    },
  }) as globalThis.ReadableStream<Uint8Array>;
}

async function parse(text: string, chunkSize?: number) {
  return Array.fromAsync(parseSseStream(createStream(text, chunkSize)));
}

describe('Dify SSE framing', () => {
  it.each(['\n', '\r', '\r\n'])(
    'handles %j delimiters, BOM and split UTF-8',
    async newline => {
      const text =
        '\uFEFF: heartbeat' +
        newline +
        'data: {"event":"message","answer":"你好 🌍"}' +
        newline +
        newline +
        'data: {"event":"message_end","message_id":"msg-1"}' +
        newline +
        newline;
      expect(await parse(text, 1)).toEqual([
        { type: 'event', event: { event: 'message', answer: '你好 🌍' } },
        { type: 'event', event: { event: 'message_end', message_id: 'msg-1' } },
      ]);
    }
  );

  it.each(['', '\n', '\r\n'])(
    'dispatches a final data frame ending with %j',
    async ending => {
      expect(
        await parse('data: {"event":"message_end","id":"last"}' + ending)
      ).toEqual([
        { type: 'event', event: { event: 'message_end', id: 'last' } },
      ]);
    }
  );

  it('accepts event-only Dify pings without creating content', async () => {
    expect(await parse('event: ping\n\ndata: {"event":"ping"}\n\n')).toEqual([
      { type: 'event', event: { event: 'ping' } },
      { type: 'event', event: { event: 'ping' } },
    ]);
  });

  it('preserves multiline JSON, named events and optional field spacing', async () => {
    expect(
      await parse(
        'event: custom_event\nid: frame-1\ndata:{\ndata: "text":"  kept  "}\n\n'
      )
    ).toEqual([
      {
        type: 'event',
        event: { event: 'custom_event', id: 'frame-1', text: '  kept  ' },
      },
    ]);
  });

  it('keeps the JSON event name and ID authoritative over SSE fields', async () => {
    expect(
      await parse(
        'event: other\nid: other\ndata: {"event":"message","id":"own"}\n\n'
      )
    ).toEqual([{ type: 'event', event: { event: 'message', id: 'own' } }]);
  });

  it('does not treat a comment, id or retry as a data event', async () => {
    expect(await parse(': ping\nid: ignored\nretry: 1000\n\n')).toEqual([]);
  });

  it.each(['not-json', 'null', '[]', '42', '"text"'])(
    'reports invalid data %j without logging the payload',
    async payload => {
      const log = jest
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);
      const error = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      try {
        const result = await parse(`data: ${payload}\n\n`);
        expect(result).toEqual([{ type: 'error', error: expect.any(Error) }]);
        expect(log).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
        error.mockRestore();
      }
    }
  );

  it('honors a legacy DONE marker and ignores later frames', async () => {
    expect(
      await parse(
        'data: [DONE]\n\ndata: {"event":"message","answer":"ignored"}\n\n'
      )
    ).toEqual([]);
  });

  it('releases the reader and cancels the stream when a consumer stops early', async () => {
    const cancel = jest.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"event":"message","answer":"first"}\n\n'
          )
        );
      },
      cancel,
    }) as globalThis.ReadableStream<Uint8Array>;
    for await (const result of parseSseStream(stream)) {
      expect(result.type).toBe('event');
      break;
    }
    expect(stream.locked).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
