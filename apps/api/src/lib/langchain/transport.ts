import {
  type AGUIEvent,
  LangChainUpstreamError,
  isLangChainId,
  parseAGUIStream,
} from './ag-ui';

export { LangChainUpstreamError } from './ag-ui';
export type { AGUIEvent } from './ag-ui';

export interface LangChainConfig {
  baseUrl: string;
  apiKey: string;
  assistantId?: string;
}

export interface LangChainTurn {
  threadId: string;
  runId: string;
  messageId: string;
  content: string;
  signal?: AbortSignal;
}

export type LangChainRunStatus =
  'pending' | 'running' | 'success' | 'error' | 'timeout' | 'interrupted';

export interface LangChainRun {
  threadId: string;
  runId: string;
  status: LangChainRunStatus;
}

const JSON_TIMEOUT_MS = 15000;
const STREAM_TIMEOUT_MS = 150000;
const MAX_JSON_BYTES = 256 * 1024;

function requestConfig(config: LangChainConfig, path: string) {
  let base: URL;
  try {
    base = new URL(config.baseUrl);
  } catch {
    throw new LangChainUpstreamError('INVALID_REQUEST');
  }
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    typeof config.apiKey !== 'string' ||
    !config.apiKey.trim() ||
    /[\r\n]/.test(config.apiKey) ||
    (config.assistantId !== undefined && !isLangChainId(config.assistantId))
  ) {
    throw new LangChainUpstreamError('INVALID_REQUEST');
  }
  return {
    url: `${base.toString().replace(/\/+$/, '')}${path}`,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
  };
}

function requireIds(...values: unknown[]) {
  if (values.some(value => !isLangChainId(value))) {
    throw new LangChainUpstreamError('INVALID_REQUEST');
  }
}

async function withRequest<T>(
  config: LangChainConfig,
  path: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  consume: (response: Response, signal: AbortSignal) => Promise<T>
): Promise<T> {
  const request = requestConfig(config, path);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) {
    throw new LangChainUpstreamError('UPSTREAM_ABORTED');
  }
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let response: Response | undefined;
  try {
    response = await fetch(request.url, {
      ...init,
      headers: { ...request.headers, ...init.headers },
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      throw new LangChainUpstreamError('UPSTREAM_HTTP_ERROR', response.status);
    }
    return await consume(response, controller.signal);
  } catch (error) {
    if (timedOut) throw new LangChainUpstreamError('UPSTREAM_TIMEOUT');
    if (signal?.aborted) throw new LangChainUpstreamError('UPSTREAM_ABORTED');
    if (error instanceof LangChainUpstreamError) throw error;
    throw new LangChainUpstreamError('UPSTREAM_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (response?.body && !response.body.locked) {
      void response.body.cancel().catch(() => undefined);
    }
    controller.abort();
  }
}

async function readJSON(response: Response, signal: AbortSignal) {
  if (!response.body) {
    throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) {
        throw new LangChainUpstreamError('UPSTREAM_ABORTED');
      }
      const result = await reader.read();
      if (signal.aborted) {
        throw new LangChainUpstreamError('UPSTREAM_ABORTED');
      }
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_JSON_BYTES) {
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      }
      chunks.push(result.value);
    }
    const parsed: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof LangChainUpstreamError) throw error;
    throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function createThread(
  config: LangChainConfig,
  signal?: AbortSignal
): Promise<{ threadId: string }> {
  return withRequest(
    config,
    '/threads',
    { method: 'POST', body: '{}' },
    signal,
    JSON_TIMEOUT_MS,
    async (response, upstreamSignal) => {
      const data = await readJSON(response, upstreamSignal);
      if (!isLangChainId(data.thread_id)) {
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      }
      return { threadId: data.thread_id };
    }
  );
}

export async function getCapabilities(
  config: LangChainConfig,
  signal?: AbortSignal
): Promise<{ assistantId: string }> {
  return withRequest(
    config,
    '/capabilities',
    { method: 'GET' },
    signal,
    JSON_TIMEOUT_MS,
    async (response, upstreamSignal) => {
      const data = await readJSON(response, upstreamSignal);
      if (!isLangChainId(data.assistant_id)) {
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      }
      return { assistantId: data.assistant_id };
    }
  );
}

export async function getRun(
  config: LangChainConfig,
  threadId: string,
  nativeRunId: string,
  signal?: AbortSignal
): Promise<LangChainRun> {
  requireIds(threadId, nativeRunId);
  return withRequest(
    config,
    `/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(nativeRunId)}`,
    { method: 'GET' },
    signal,
    JSON_TIMEOUT_MS,
    async (response, upstreamSignal) => {
      const data = await readJSON(response, upstreamSignal);
      const statuses: string[] = [
        'pending',
        'running',
        'success',
        'error',
        'timeout',
        'interrupted',
      ];
      if (
        data.thread_id !== threadId ||
        data.run_id !== nativeRunId ||
        typeof data.status !== 'string' ||
        !statuses.includes(data.status)
      ) {
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      }
      return {
        threadId,
        runId: nativeRunId,
        status: data.status as LangChainRunStatus,
      };
    }
  );
}

export async function* streamTurn(
  config: LangChainConfig,
  turn: LangChainTurn
): AsyncGenerator<AGUIEvent> {
  requireIds(turn.threadId, turn.runId, turn.messageId);
  if (
    typeof turn.content !== 'string' ||
    !turn.content.trim() ||
    [...turn.content].length > 16000
  ) {
    throw new LangChainUpstreamError('INVALID_REQUEST');
  }
  const body = JSON.stringify({
    threadId: turn.threadId,
    runId: turn.runId,
    messages: [{ id: turn.messageId, role: 'user', content: turn.content }],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  });
  if (Buffer.byteLength(body, 'utf8') > 64 * 1024) {
    throw new LangChainUpstreamError('INVALID_REQUEST');
  }
  if (config.assistantId !== undefined) {
    const capabilities = await getCapabilities(config, turn.signal);
    if (capabilities.assistantId !== config.assistantId) {
      throw new LangChainUpstreamError('INVALID_REQUEST');
    }
  }
  const request = requestConfig(config, '/ag-ui');
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (turn.signal?.aborted) {
    throw new LangChainUpstreamError('UPSTREAM_ABORTED');
  }
  turn.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, STREAM_TIMEOUT_MS);
  let response: Response | undefined;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: { ...request.headers, Accept: 'text/event-stream' },
      body,
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      throw new LangChainUpstreamError('UPSTREAM_HTTP_ERROR', response.status);
    }
    if (
      !response.body ||
      response.headers
        .get('content-type')
        ?.split(';')[0]
        .trim()
        .toLowerCase() !== 'text/event-stream'
    ) {
      throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
    }
    yield* parseAGUIStream(response.body, {
      threadId: turn.threadId,
      runId: turn.runId,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new LangChainUpstreamError('UPSTREAM_TIMEOUT');
    if (turn.signal?.aborted) {
      throw new LangChainUpstreamError('UPSTREAM_ABORTED');
    }
    if (error instanceof LangChainUpstreamError) throw error;
    throw new LangChainUpstreamError('UPSTREAM_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    turn.signal?.removeEventListener('abort', abort);
    if (response?.body && !response.body.locked) {
      void response.body.cancel().catch(() => undefined);
    }
    controller.abort();
  }
}
