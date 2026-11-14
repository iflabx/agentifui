export type LangChainErrorCode =
  | 'INVALID_REQUEST'
  | 'UPSTREAM_HTTP_ERROR'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_ABORTED'
  | 'UPSTREAM_PROTOCOL_ERROR'
  | 'UPSTREAM_INCOMPLETE';

export class LangChainUpstreamError extends Error {
  constructor(
    public readonly code: LangChainErrorCode,
    public readonly status?: number
  ) {
    super(code);
    this.name = 'LangChainUpstreamError';
  }
}

export type AGUIEvent =
  | { type: 'RUN_STARTED'; threadId: string; runId: string }
  | { type: 'CUSTOM'; name: 'native_run'; value: { run_id: string } }
  | { type: 'TEXT_MESSAGE_START'; messageId: string; role: 'assistant' }
  | { type: 'TEXT_MESSAGE_CONTENT'; messageId: string; delta: string }
  | { type: 'TEXT_MESSAGE_END'; messageId: string }
  | {
      type: 'TOOL_CALL_START';
      toolCallId: string;
      toolCallName: string;
      parentMessageId?: string;
    }
  | { type: 'TOOL_CALL_ARGS'; toolCallId: string }
  | { type: 'TOOL_CALL_END'; toolCallId: string }
  | {
      type: 'TOOL_CALL_RESULT';
      toolCallId: string;
      messageId: string;
      role: 'tool';
      content: string;
    }
  | { type: 'RUN_FINISHED'; threadId: string; runId: string }
  | { type: 'RUN_ERROR'; code: string; message: string };

export interface AGUIStreamOptions {
  threadId: string;
  runId: string;
  signal?: AbortSignal;
}

const MAX_EVENT_BYTES = 256 * 1024;
const MAX_STREAM_BYTES = 4 * 1024 * 1024;
const MAX_EVENTS = 20000;
const MAX_ITEMS = 1024;
const SAFE_ERRORS: Record<string, string> = {
  MODEL_TIMEOUT: 'The model request timed out.',
  AGENT_RUN_FAILED: 'The agent run failed.',
  AGENT_STREAM_FAILED: 'The agent stream failed.',
  RUN_INCOMPLETE: 'The agent run could not be confirmed.',
};

function protocolError(): never {
  throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
}

export function isLangChainId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/.test(value)
  );
}

function id(value: unknown): string {
  if (!isLangChainId(value)) protocolError();
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    protocolError();
  }
  return value as Record<string, unknown>;
}

class EventSequence {
  private started = false;
  private nativeRunId?: string;
  private messages = new Map<string, boolean>();
  private tools = new Map<string, 'args' | 'ended' | 'result'>();
  terminal?: AGUIEvent;

  constructor(private readonly expected: AGUIStreamOptions) {}

  accept(input: unknown): AGUIEvent | undefined {
    const event = object(input);
    if (this.terminal) protocolError();
    if (
      (event.threadId !== undefined &&
        event.threadId !== this.expected.threadId) ||
      (event.runId !== undefined && event.runId !== this.expected.runId)
    ) {
      protocolError();
    }
    if (event.type === 'RUN_STARTED') {
      if (this.started) protocolError();
      this.checkIdentity(event);
      this.started = true;
      return {
        type: 'RUN_STARTED',
        threadId: this.expected.threadId,
        runId: this.expected.runId,
      };
    }
    if (!this.started) protocolError();
    if (event.type === 'CUSTOM') {
      if (event.name !== 'native_run') return undefined;
      if (this.nativeRunId) protocolError();
      this.nativeRunId = id(object(event.value).run_id);
      return {
        type: 'CUSTOM',
        name: 'native_run',
        value: { run_id: this.nativeRunId },
      };
    }
    if (event.type === 'RUN_FINISHED') {
      this.checkIdentity(event);
      if (
        event.outcome !== undefined &&
        object(event.outcome).type !== 'success'
      ) {
        protocolError();
      }
      if (
        !this.nativeRunId ||
        [...this.messages.values()].some(ended => !ended) ||
        [...this.tools.values()].some(state => state !== 'result')
      ) {
        protocolError();
      }
      this.terminal = {
        type: 'RUN_FINISHED',
        threadId: this.expected.threadId,
        runId: this.expected.runId,
      };
      return undefined;
    }
    if (event.type === 'RUN_ERROR') {
      const code =
        typeof event.code === 'string' && Object.hasOwn(SAFE_ERRORS, event.code)
          ? event.code
          : 'RUN_INCOMPLETE';
      this.terminal = {
        type: 'RUN_ERROR',
        code,
        message: SAFE_ERRORS[code],
      };
      return undefined;
    }
    if (
      typeof event.type === 'string' &&
      event.type.startsWith('TEXT_MESSAGE_')
    ) {
      return this.text(event);
    }
    return this.tool(event);
  }

  private checkIdentity(event: Record<string, unknown>) {
    if (
      event.threadId !== this.expected.threadId ||
      event.runId !== this.expected.runId
    ) {
      protocolError();
    }
  }

  private text(event: Record<string, unknown>): AGUIEvent {
    const messageId = id(event.messageId);
    if (event.type === 'TEXT_MESSAGE_START') {
      if (
        this.messages.has(messageId) ||
        this.messages.size >= MAX_ITEMS ||
        event.role !== 'assistant'
      ) {
        protocolError();
      }
      this.messages.set(messageId, false);
      return { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' };
    }
    if (this.messages.get(messageId) !== false) protocolError();
    if (event.type === 'TEXT_MESSAGE_CONTENT') {
      if (typeof event.delta !== 'string') protocolError();
      return { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: event.delta };
    }
    if (event.type !== 'TEXT_MESSAGE_END') protocolError();
    this.messages.set(messageId, true);
    return { type: 'TEXT_MESSAGE_END', messageId };
  }

  private tool(event: Record<string, unknown>): AGUIEvent {
    const toolCallId = id(event.toolCallId);
    if (event.type === 'TOOL_CALL_START') {
      if (
        this.tools.has(toolCallId) ||
        this.tools.size >= MAX_ITEMS ||
        typeof event.toolCallName !== 'string' ||
        !/^[A-Za-z0-9_.-]{1,128}$/.test(event.toolCallName)
      ) {
        protocolError();
      }
      this.tools.set(toolCallId, 'args');
      return {
        type: 'TOOL_CALL_START',
        toolCallId,
        toolCallName: event.toolCallName,
        ...(event.parentMessageId !== undefined
          ? { parentMessageId: id(event.parentMessageId) }
          : {}),
      };
    }
    const state = this.tools.get(toolCallId);
    if (event.type === 'TOOL_CALL_ARGS') {
      if (state !== 'args' || typeof event.delta !== 'string') protocolError();
      return { type: 'TOOL_CALL_ARGS', toolCallId };
    }
    if (event.type === 'TOOL_CALL_END') {
      if (state !== 'args') protocolError();
      this.tools.set(toolCallId, 'ended');
      return { type: 'TOOL_CALL_END', toolCallId };
    }
    if (event.type !== 'TOOL_CALL_RESULT' || state !== 'ended') protocolError();
    if (event.role !== undefined && event.role !== 'tool') protocolError();
    if (typeof event.content !== 'string') protocolError();
    this.tools.set(toolCallId, 'result');
    return {
      type: 'TOOL_CALL_RESULT',
      toolCallId,
      messageId: id(event.messageId),
      role: 'tool',
      content: 'Tool result received.',
    };
  }
}

export async function* parseAGUIStream(
  stream: ReadableStream<Uint8Array>,
  options: AGUIStreamOptions
): AsyncGenerator<AGUIEvent> {
  if (!isLangChainId(options.threadId) || !isLangChainId(options.runId)) {
    throw new LangChainUpstreamError('INVALID_REQUEST');
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const sequence = new EventSequence(options);
  let buffered = '';
  let bufferedBytes = 0;
  let scanOffset = 0;
  let data: string[] = [];
  let frameBytes = 0;
  let totalBytes = 0;
  let eventCount = 0;
  let complete = false;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  const line = (value: string): AGUIEvent | undefined => {
    frameBytes += Buffer.byteLength(value, 'utf8') + 1;
    if (frameBytes > MAX_EVENT_BYTES) protocolError();
    if (value === '') {
      frameBytes = 0;
      if (data.length === 0) return undefined;
      if (++eventCount > MAX_EVENTS) protocolError();
      const json = data.join('\n');
      data = [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        protocolError();
      }
      return sequence.accept(parsed);
    }
    if (value.startsWith('data:')) {
      data.push(value.slice(value[5] === ' ' ? 6 : 5));
    }
    return undefined;
  };
  try {
    while (true) {
      if (options.signal?.aborted) {
        throw new LangChainUpstreamError('UPSTREAM_ABORTED');
      }
      const result = await reader.read();
      if (options.signal?.aborted) {
        throw new LangChainUpstreamError('UPSTREAM_ABORTED');
      }
      if (!result.done) {
        totalBytes += result.value.byteLength;
        if (totalBytes > MAX_STREAM_BYTES) protocolError();
      }
      const decoded = decoder.decode(result.value, { stream: !result.done });
      buffered += decoded;
      bufferedBytes += Buffer.byteLength(decoded, 'utf8');
      let offset = 0;
      let index = scanOffset;
      for (; index < buffered.length; index++) {
        const char = buffered[index];
        if (char !== '\n' && char !== '\r') continue;
        if (char === '\r' && index === buffered.length - 1 && !result.done) {
          break;
        }
        const event = line(buffered.slice(offset, index));
        if (event) yield event;
        if (char === '\r' && buffered[index + 1] === '\n') index++;
        offset = index + 1;
      }
      bufferedBytes -= Buffer.byteLength(buffered.slice(0, offset), 'utf8');
      buffered = buffered.slice(offset);
      scanOffset = index - offset;
      if (bufferedBytes + frameBytes > MAX_EVENT_BYTES) {
        protocolError();
      }
      if (!result.done) continue;
      if (buffered || data.length) {
        throw new LangChainUpstreamError('UPSTREAM_INCOMPLETE');
      }
      if (!sequence.terminal) {
        throw new LangChainUpstreamError('UPSTREAM_INCOMPLETE');
      }
      complete = true;
      yield sequence.terminal;
      return;
    }
  } catch (error) {
    if (error instanceof LangChainUpstreamError) throw error;
    throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
  } finally {
    options.signal?.removeEventListener('abort', abort);
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
