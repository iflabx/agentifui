/** @jest-environment node */
import { ReadableStream } from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';

import {
  executeDifyCompletion,
  streamDifyCompletion,
} from './completion-service';
import type { DifyCompletionRequestPayload } from './types';

global.TextDecoder = TextDecoder as typeof global.TextDecoder;

const payload: DifyCompletionRequestPayload = {
  inputs: { topic: 'Example' },
  response_mode: 'blocking',
  user: 'user-1',
};

function frame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function createBody(
  content: string,
  chunkSize?: number
): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(content);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const size = chunkSize || encoded.length || 1;
      for (let offset = 0; offset < encoded.length; offset += size) {
        controller.enqueue(encoded.slice(offset, offset + size));
      }
      controller.close();
    },
  });
}

function mockResponse(body: ReadableStream<Uint8Array>) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    body,
  });
}

async function collectStream(
  stream: AsyncGenerator<string, void, undefined>
): Promise<string> {
  let content = '';
  for await (const chunk of stream) {
    content += chunk;
  }
  return content;
}

describe('executeDifyCompletion', () => {
  const blockingResult = {
    message_id: 'message-1',
    mode: 'completion',
    answer: 'Answer',
    created_at: 1,
  };

  function mockBlockingResponse(result: unknown) {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => result,
    });
  }

  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('forces blocking mode without changing the supplied payload', async () => {
    const request: DifyCompletionRequestPayload = {
      ...payload,
      response_mode: 'streaming',
    };
    mockBlockingResponse({ ...blockingResult, metadata: {} });

    await executeDifyCompletion('app-1', request);

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dify/app-1/completion-messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agentifui-submission-id': expect.any(String),
        },
        body: JSON.stringify({ ...request, response_mode: 'blocking' }),
      }
    );
    expect(request.response_mode).toBe('streaming');
  });

  it('prefers nested usage and preserves metadata and other response fields', async () => {
    const usage = { total_tokens: 12, total_price: '0.02', currency: 'USD' };
    const metadata = { usage, custom: { source: 'fixture' } };
    const upstream = {
      ...blockingResult,
      metadata,
      usage: { total_tokens: 99 },
    };
    mockBlockingResponse(upstream);

    const result = await executeDifyCompletion('app-1', payload);

    expect(result).toEqual({ ...upstream, usage });
    expect(result.metadata).toBe(metadata);
    expect(upstream.usage).toEqual({ total_tokens: 99 });
  });

  it('normalizes metadata-only usage from the official blocking response shape', async () => {
    const usage = { total_tokens: 12 };
    const metadata = { usage };
    mockBlockingResponse({ ...blockingResult, metadata });

    const result = await executeDifyCompletion('app-1', payload);

    expect(result.usage).toEqual(usage);
    expect(result.metadata).toBe(metadata);
  });

  it.each([undefined, { total_tokens: 'invalid' }])(
    'falls back to top-level usage when nested usage is %p',
    async nestedUsage => {
      const usage = { total_tokens: 7 };
      const metadata = { usage: nestedUsage, extra: true };
      mockBlockingResponse({ ...blockingResult, metadata, usage });

      const result = await executeDifyCompletion('app-1', payload);

      expect(result.usage).toEqual(usage);
      expect(result.metadata).toBe(metadata);
    }
  );

  it.each([
    { metadata: {} },
    {
      metadata: { usage: { total_tokens: 'invalid' } },
      usage: { total_tokens: 'invalid' },
    },
  ])('leaves normalized usage undefined when unavailable: %p', async fields => {
    const upstream = { ...blockingResult, ...fields };
    mockBlockingResponse(upstream);

    const result = await executeDifyCompletion('app-1', payload);

    expect(result.usage).toBeUndefined();
    expect(result.metadata).toBe(upstream.metadata);
    expect(result.answer).toBe(blockingResult.answer);
  });
});

describe('streamDifyCompletion', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('preserves the request contract and streams JSON and UTF-8 split across bytes', async () => {
    const answer = 'Hello \u4e16\u754c \ud83c\udf0d';
    const body = createBody(
      frame({
        event: 'message',
        id: 'message-1',
        task_id: 'task-1',
        answer,
      }) + frame({ event: 'message_end', id: 'message-1', metadata: {} }),
      1
    );
    mockResponse(body);

    const response = await streamDifyCompletion('app-1', payload);

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dify/app-1/completion-messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agentifui-submission-id': expect.any(String),
        },
        body: JSON.stringify({ ...payload, response_mode: 'streaming' }),
      }
    );
    await expect(collectStream(response.answerStream)).resolves.toBe(answer);
    expect(response.getMessageId()).toBe('message-1');
    expect(response.getTaskId()).toBe('task-1');
    await expect(response.completionPromise).resolves.toMatchObject({
      metadata: {
        has_content: true,
        message_id: 'message-1',
        task_id: 'task-1',
      },
    });
    expect(body.locked).toBe(false);
  });

  it('prefers message_id and nested metadata usage while preserving metadata', async () => {
    const usage = { total_tokens: 12, total_price: '0.02', currency: 'USD' };
    const metadata = { usage, custom: { source: 'fixture' } };
    const body = createBody(
      frame({
        event: 'message',
        id: 'chunk-1',
        message_id: 'message-1',
        task_id: 'task-1',
        answer: 'Answer',
      }) +
        frame({
          event: 'message_end',
          id: 'end-1',
          message_id: 'message-1',
          metadata,
          usage: { total_tokens: 99 },
        })
    );
    mockResponse(body);

    const response = await streamDifyCompletion('app-1', payload);
    await collectStream(response.answerStream);

    expect(response.getMessageId()).toBe('message-1');
    await expect(response.completionPromise).resolves.toEqual({
      usage,
      metadata: {
        ...metadata,
        has_content: true,
        message_id: 'message-1',
        task_id: 'task-1',
      },
    });
    expect(body.locked).toBe(false);
  });

  it('does not overwrite a preferred message_id with a later legacy event id', async () => {
    mockResponse(
      createBody(
        frame({ event: 'message', message_id: 'message-1', answer: 'Answer' }) +
          frame({ event: 'message_end', id: 'end-1', metadata: {} })
      )
    );
    const response = await streamDifyCompletion('app-1', payload);
    await collectStream(response.answerStream);

    expect(response.getMessageId()).toBe('message-1');
    await expect(response.completionPromise).resolves.toMatchObject({
      metadata: { message_id: 'message-1' },
    });
  });

  it.each([undefined, { total_tokens: 'invalid' }])(
    'falls back to validated top-level usage when nested usage is %p',
    async nestedUsage => {
      mockResponse(
        createBody(
          frame({
            event: 'message_end',
            id: 'message-1',
            metadata: { usage: nestedUsage, extra: true },
            usage: { total_tokens: 7 },
          })
        )
      );
      const response = await streamDifyCompletion('app-1', payload);
      await collectStream(response.answerStream);

      await expect(response.completionPromise).resolves.toMatchObject({
        usage: { total_tokens: 7 },
        metadata: { extra: true, has_content: false, message_id: 'message-1' },
      });
    }
  );

  it('does not expose invalid usage as a DifyUsage result', async () => {
    mockResponse(
      createBody(
        frame({
          event: 'message_end',
          metadata: { usage: { total_tokens: 'invalid' } },
          usage: { total_tokens: 'invalid' },
        })
      )
    );
    const response = await streamDifyCompletion('app-1', payload);
    await collectStream(response.answerStream);

    expect((await response.completionPromise).usage).toBeUndefined();
  });

  it('accepts BOM, comments, bare ping, CR/LF/CRLF, and an EOF terminal frame', async () => {
    const content =
      '\uFEFF: heartbeat\revent: ping\r\r' +
      frame({ event: 'message', id: 'message-1', answer: 'Answer' }).replaceAll(
        '\n',
        '\r\n'
      ) +
      'data:' +
      JSON.stringify({ event: 'message_end', id: 'message-1', metadata: {} }) +
      '\n';
    const body = createBody(content, 1);
    mockResponse(body);
    const response = await streamDifyCompletion('app-1', payload);

    await expect(collectStream(response.answerStream)).resolves.toBe('Answer');
    await expect(response.completionPromise).resolves.toMatchObject({
      metadata: { has_content: true, message_id: 'message-1' },
    });
    expect(body.locked).toBe(false);
  });

  it('ignores unknown events without replacing message identifiers', async () => {
    mockResponse(
      createBody(
        frame({ event: 'message', id: 'message-1', answer: 'Answer' }) +
          frame({ event: 'future_event', id: 'unrelated-1' }) +
          frame({ event: 'message_end', metadata: {} })
      )
    );
    const response = await streamDifyCompletion('app-1', payload);

    await expect(collectStream(response.answerStream)).resolves.toBe('Answer');
    expect(response.getMessageId()).toBe('message-1');
  });

  it.each(['', 'data: [DONE]\n\n'])(
    'settles a clean stream without message_end with suffix %p',
    async suffix => {
      const body = createBody(
        frame({
          event: 'message',
          id: 'message-1',
          task_id: 'task-1',
          answer: 'Answer',
        }) + suffix
      );
      mockResponse(body);
      const response = await streamDifyCompletion('app-1', payload);

      await expect(collectStream(response.answerStream)).resolves.toBe(
        'Answer'
      );
      await expect(response.completionPromise).resolves.toMatchObject({
        metadata: {
          has_content: true,
          message_id: 'message-1',
          task_id: 'task-1',
        },
      });
      expect(body.locked).toBe(false);
    }
  );

  it('settles an empty clean stream without claiming generated content', async () => {
    const body = createBody('');
    mockResponse(body);
    const response = await streamDifyCompletion('app-1', payload);

    await expect(collectStream(response.answerStream)).resolves.toBe('');
    await expect(response.completionPromise).resolves.toMatchObject({
      metadata: { stream_completed: true, has_content: false },
    });
    expect(body.locked).toBe(false);
  });

  it('settles on message_end and cancels the reader without waiting for EOF', async () => {
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            frame({ event: 'message', answer: 'Answer' }) +
              frame({ event: 'message_end', id: 'message-1', metadata: {} })
          )
        );
      },
      cancel,
    });
    mockResponse(body);
    const response = await streamDifyCompletion('app-1', payload);

    await expect(collectStream(response.answerStream)).resolves.toBe('Answer');
    await expect(response.completionPromise).resolves.toMatchObject({
      metadata: { has_content: true, message_id: 'message-1' },
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('rejects both channels on malformed JSON instead of completing successfully', async () => {
    const body = createBody('data: {invalid}\n\n');
    mockResponse(body);
    const response = await streamDifyCompletion('app-1', payload);
    const completion = response.completionPromise.catch(error => error);

    await expect(collectStream(response.answerStream)).rejects.toBeInstanceOf(
      Error
    );
    expect(await completion).toBeInstanceOf(Error);
    expect(body.locked).toBe(false);
  });

  it('rejects malformed known message payloads', async () => {
    const body = createBody(frame({ event: 'message', answer: 42 }));
    mockResponse(body);
    const response = await streamDifyCompletion('app-1', payload);
    const completion = response.completionPromise.catch(error => error);

    await expect(collectStream(response.answerStream)).rejects.toThrow(
      /answer/i
    );
    expect(await completion).toBeInstanceOf(Error);
    expect(body.locked).toBe(false);
  });

  it('throws upstream errors from the answer stream and rejects completion after partial output', async () => {
    const body = createBody(
      frame({ event: 'message', answer: 'Partial answer' }) +
        frame({
          event: 'error',
          code: 'provider_error',
          message: 'Provider failed',
        })
    );
    mockResponse(body);
    const response = await streamDifyCompletion('app-1', payload);
    const completion = response.completionPromise.catch(error => error);

    await expect(response.answerStream.next()).resolves.toEqual({
      done: false,
      value: 'Partial answer',
    });
    await expect(response.answerStream.next()).rejects.toThrow(
      'Provider failed'
    );
    expect(await completion).toEqual(new Error('Provider failed'));
    expect(body.locked).toBe(false);
  });

  it('propagates reader errors to both channels and releases the reader', async () => {
    const failure = new Error('Connection interrupted');
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(failure);
      },
    });
    mockResponse(body);
    const response = await streamDifyCompletion('app-1', payload);
    const completion = response.completionPromise.catch(error => error);

    await expect(collectStream(response.answerStream)).rejects.toThrow(failure);
    expect(await completion).toBe(failure);
    expect(body.locked).toBe(false);
  });

  it('settles completion and releases the reader when the consumer stops early', async () => {
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            frame({ event: 'message', answer: 'First chunk' }) +
              frame({ event: 'message', answer: 'Second chunk' })
          )
        );
      },
      cancel,
    });
    mockResponse(body);
    const response = await streamDifyCompletion('app-1', payload);
    const completion = response.completionPromise.catch(error => error);

    await response.answerStream.next();
    await response.answerStream.return();

    expect(await completion).toBeInstanceOf(Error);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('settles completion and cancels an unread body when stopped before consumption', async () => {
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    mockResponse(body);
    const response = await streamDifyCompletion('app-1', payload);
    const completion = response.completionPromise.catch(error => error);

    await response.answerStream.return();

    expect(await completion).toBeInstanceOf(Error);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });
});
