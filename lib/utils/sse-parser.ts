import type { DifySseEvent } from '@lib/services/dify/types';

export type SseParserResult =
  { type: 'event'; event: DifySseEvent } | { type: 'error'; error: Error };

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SseParserResult, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let line = '';
  let eventName = '';
  let eventId = '';
  let dataLines: string[] = [];
  let skipLineFeed = false;
  let streamEnded = false;
  let terminated = false;

  function dispatchEvent(): SseParserResult | undefined {
    const data = dataLines.join('\n');
    const name = eventName;
    const id = eventId;
    eventName = '';
    eventId = '';
    dataLines = [];

    if (!data) {
      return name === 'ping'
        ? { type: 'event', event: { event: 'ping' } as DifySseEvent }
        : undefined;
    }
    if (data === '[DONE]') {
      terminated = true;
      return undefined;
    }

    try {
      const parsed: unknown = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected an SSE JSON object');
      }
      const payload = parsed as Record<string, unknown>;
      return {
        type: 'event',
        event: {
          ...payload,
          ...(id && !payload.id ? { id } : {}),
          event:
            typeof payload.event === 'string' && payload.event
              ? payload.event
              : name || 'message',
        } as DifySseEvent,
      };
    } catch {
      return {
        type: 'error',
        error: new Error('Invalid Dify SSE JSON payload'),
      };
    }
  }

  function processLine(value: string): SseParserResult | undefined {
    if (value === '') return dispatchEvent();
    if (value.startsWith(':')) return undefined;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'data') dataLines.push(content);
    if (field === 'event') eventName = content;
    if (field === 'id' && !content.includes('\0')) eventId = content;
    return undefined;
  }

  function* processText(text: string): Generator<SseParserResult> {
    for (const character of text) {
      if (skipLineFeed) {
        skipLineFeed = false;
        if (character === '\n') continue;
      }
      if (character === '\r' || character === '\n') {
        const result = processLine(line);
        line = '';
        skipLineFeed = character === '\r';
        if (result) yield result;
        if (terminated) return;
      } else {
        line += character;
      }
    }
  }

  try {
    while (!terminated) {
      const { done, value } = await reader.read();
      if (done) {
        streamEnded = true;
        yield* processText(decoder.decode());
        if (terminated) return;
        if (line) {
          const result = processLine(line);
          if (result) yield result;
        }
        const result = dispatchEvent();
        if (result) yield result;
        return;
      }
      yield* processText(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    yield {
      type: 'error',
      error:
        error instanceof Error ? error : new Error('Unable to read SSE stream'),
    };
  } finally {
    if (!streamEnded) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
