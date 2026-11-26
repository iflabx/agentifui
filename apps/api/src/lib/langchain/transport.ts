import type { AgentInputCapabilities } from '@agentifui/shared';

import {
  type AgentDeliverables,
  MAX_RESULT_ARTIFACT_BYTES,
  MAX_RESULT_MANIFEST_BYTES,
  PHASE4_RESULT_PROFILE,
  parseAgentDeliverables,
} from '../agent-result';
import {
  type AGUIEvent,
  LangChainUpstreamError,
  isLangChainId,
  parseAGUIStream,
} from './ag-ui';
import {
  LANGCHAIN_INPUT_PROFILE,
  type LangChainInputFileRef,
  type LangChainInputPath,
  isLangChainInputFileId,
  langChainInputPath,
  parseLangChainInputProfile,
  validateLangChainTurnInput,
} from './input-profile';

export { LangChainUpstreamError } from './ag-ui';
export type { AGUIEvent } from './ag-ui';

export interface LangChainConfig {
  baseUrl: string;
  apiKey: string;
  assistantId?: string;
  resultProfileEnabled?: boolean;
  scope?: { actorId: string; appId: string };
}

export interface LangChainTurn {
  threadId: string;
  runId: string;
  messageId: string;
  content: string;
  inputFiles?: LangChainInputFileRef[];
  signal?: AbortSignal;
  beforeDispatch?: () => Promise<void>;
  onDispatch?: () => void;
}

export type LangChainRunStatus =
  'pending' | 'running' | 'success' | 'error' | 'timeout' | 'interrupted';

export interface LangChainRun {
  threadId: string;
  runId: string;
  status: LangChainRunStatus;
}

export interface LangChainCapabilities {
  assistantId: string;
  aguiPath?: '/ag-ui' | '/ag-ui/deep' | LangChainInputPath;
  inputCapabilities?: AgentInputCapabilities;
  resultProfile?: string;
  resultFormats?: string[];
}

export function supportsResultArtifacts(
  capabilities: LangChainCapabilities
): boolean {
  return (
    capabilities.aguiPath === '/ag-ui/deep' &&
    capabilities.resultProfile === PHASE4_RESULT_PROFILE &&
    capabilities.resultFormats?.includes('text/markdown') === true &&
    capabilities.resultFormats?.includes('text/csv') === true
  );
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
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (
    path !== '/capabilities' &&
    (config.scope || langChainInputPath(config.assistantId ?? ''))
  ) {
    const { actorId, appId } = config.scope ?? {};
    if (
      typeof actorId !== 'string' ||
      typeof appId !== 'string' ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(actorId) ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(appId)
    ) {
      throw new LangChainUpstreamError('INVALID_REQUEST');
    }
    headers['X-AgentifUI-Actor'] = actorId;
    headers['X-AgentifUI-App'] = appId;
  }
  return {
    url: `${base.toString().replace(/\/+$/, '')}${path}`,
    headers,
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
  init: RequestInit & { headers?: Record<string, string> },
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
    const headers: Record<string, string> = { ...request.headers };
    if (init.body instanceof FormData) delete headers['Content-Type'];
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    response = await fetch(request.url, {
      ...init,
      headers,
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

async function readJSON(
  response: Response,
  signal: AbortSignal,
  allowArray = false,
  maxBytes = MAX_JSON_BYTES
) {
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
      if (bytes > maxBytes) {
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      }
      chunks.push(result.value);
    }
    const parsed: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    );
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (!allowArray && Array.isArray(parsed))
    ) {
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

async function readBytes(
  response: Response,
  signal: AbortSignal,
  maxBytes: number
): Promise<Uint8Array> {
  if (!response.body)
    throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes)
    throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new LangChainUpstreamError('UPSTREAM_ABORTED');
      const result = await reader.read();
      if (signal.aborted) throw new LangChainUpstreamError('UPSTREAM_ABORTED');
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maxBytes)
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      chunks.push(result.value);
    }
    return Buffer.concat(chunks).subarray(0, bytes);
  } catch (error) {
    if (error instanceof LangChainUpstreamError) throw error;
    throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function nativeJSON(
  config: LangChainConfig,
  path: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  return withRequest(
    config,
    path,
    body === undefined
      ? { method: 'GET' }
      : { method: 'POST', body: JSON.stringify(body) },
    signal,
    JSON_TIMEOUT_MS,
    (response, signal) => readJSON(response, signal, true)
  );
}

export async function getThreadState(
  config: LangChainConfig,
  threadId: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  requireIds(threadId);
  return withRequest(
    config,
    `/threads/${encodeURIComponent(threadId)}/state`,
    { method: 'GET' },
    signal,
    JSON_TIMEOUT_MS,
    (response, upstreamSignal) => readJSON(response, upstreamSignal)
  );
}

function inputFilePath(config: LangChainConfig, fileId?: string) {
  const assistant = config.assistantId;
  if (
    !assistant ||
    !langChainInputPath(assistant) ||
    (fileId !== undefined && !isLangChainInputFileId(fileId))
  ) {
    throw new LangChainUpstreamError('INVALID_REQUEST');
  }
  const path = `/assistants/${encodeURIComponent(assistant)}/files`;
  return fileId === undefined ? path : `${path}/${fileId}`;
}

export async function uploadNativeInputFile(
  config: LangChainConfig,
  slotKey: string,
  file: File
): Promise<Record<string, unknown>> {
  const body = new FormData();
  body.append('slotKey', slotKey);
  body.append('file', file);
  return withRequest(
    config,
    inputFilePath(config),
    { method: 'POST', body },
    undefined,
    35000,
    (response, signal) => readJSON(response, signal)
  );
}

export async function getNativeInputFileMetadata(
  config: LangChainConfig,
  fileId: string
): Promise<Record<string, unknown>> {
  return withRequest(
    config,
    inputFilePath(config, fileId),
    { method: 'GET' },
    undefined,
    JSON_TIMEOUT_MS,
    (response, signal) => readJSON(response, signal)
  );
}

export async function getNativeInputFileContent(
  config: LangChainConfig,
  fileId: string,
  expected: { size: number; type: string }
): Promise<Uint8Array> {
  return withRequest(
    config,
    `${inputFilePath(config, fileId)}/content`,
    { method: 'GET' },
    undefined,
    JSON_TIMEOUT_MS,
    async (response, signal) => {
      if (
        response.headers
          .get('content-type')
          ?.split(';')[0]
          .trim()
          .toLowerCase() !== expected.type
      ) {
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      }
      const bytes = await readBytes(response, signal, expected.size);
      if (bytes.byteLength !== expected.size) {
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      }
      return bytes;
    }
  );
}

export async function streamNativeRun(
  config: LangChainConfig,
  threadId: string,
  body: Record<string, unknown>,
  onRun: (nativeRunId: string) => Promise<void>,
  beforeDispatch: () => Promise<void>,
  onDispatch: () => void
): Promise<void> {
  requireIds(threadId);
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024)
    throw new LangChainUpstreamError('INVALID_REQUEST');
  requestConfig(config, '/threads');
  await beforeDispatch();
  onDispatch();
  return withRequest(
    config,
    `/threads/${encodeURIComponent(threadId)}/runs/stream`,
    {
      method: 'POST',
      body: serialized,
      headers: { Accept: 'text/event-stream' },
    },
    undefined,
    STREAM_TIMEOUT_MS,
    async (response, signal) => {
      if (
        !response.body ||
        !response.headers.get('content-type')?.includes('text/event-stream')
      )
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let buffer = '';
      let bytes = 0;
      const abort = () => {
        void reader.cancel().catch(() => undefined);
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        while (true) {
          const part = await reader.read();
          if (signal.aborted)
            throw new LangChainUpstreamError('UPSTREAM_ABORTED');
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 4 * 1024 * 1024)
            throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
          buffer += decoder.decode(part.value, { stream: true });
          let boundary: RegExpExecArray | null;
          while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            const frame = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            if (Buffer.byteLength(frame) > 256 * 1024)
              throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
            const lines = frame.split(/\r?\n/);
            const event = lines
              .find(line => line.startsWith('event:'))
              ?.slice(6)
              .trim();
            const data = lines
              .filter(line => line.startsWith('data:'))
              .map(line => line.slice(5).trimStart())
              .join('\n');
            if (!data) continue;
            if (event === 'metadata') {
              const metadata = JSON.parse(data) as Record<string, unknown>;
              if (!isLangChainId(metadata.run_id))
                throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
              await onRun(metadata.run_id);
            }
            if (event === 'error')
              throw new LangChainUpstreamError('UPSTREAM_INCOMPLETE');
          }
          if (Buffer.byteLength(buffer) > 256 * 1024)
            throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
        }
        if (buffer.trim())
          throw new LangChainUpstreamError('UPSTREAM_INCOMPLETE');
      } finally {
        signal.removeEventListener('abort', abort);
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    }
  );
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
): Promise<LangChainCapabilities> {
  return withRequest(
    config,
    '/capabilities',
    { method: 'GET' },
    signal,
    JSON_TIMEOUT_MS,
    async (response, upstreamSignal) => {
      const data = await readJSON(response, upstreamSignal);
      const advertisedId = data.assistant_id;
      if (!isLangChainId(advertisedId))
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      const advertisedAssistantId = String(advertisedId);
      const agents = Array.isArray(data.agents) ? data.agents : [];
      const selectedId = config.assistantId ?? advertisedId;
      if (!isLangChainId(selectedId))
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      const inputPath = langChainInputPath(selectedId);
      if (
        !inputPath &&
        agents.length === 0 &&
        config.assistantId &&
        advertisedAssistantId !== config.assistantId
      ) {
        return {
          assistantId: advertisedAssistantId,
        };
      }
      const matching = agents.filter(
        value =>
          value &&
          typeof value === 'object' &&
          (value as Record<string, unknown>).assistant_id === selectedId
      ) as Record<string, unknown>[];
      const selected = matching[0];
      if (matching.length > 1)
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      if (inputPath && selected?.ag_ui_path !== inputPath)
        throw new LangChainUpstreamError('INPUT_PROFILE_UNSUPPORTED');
      if (agents.length > 0 && !selected)
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      const rawPath = selected?.ag_ui_path ?? '/ag-ui';
      if (
        rawPath !== '/ag-ui' &&
        rawPath !== '/ag-ui/deep' &&
        !(inputPath && rawPath === inputPath)
      )
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      if (!inputPath && selected && Object.hasOwn(selected, 'inputs'))
        throw new LangChainUpstreamError('INPUT_PROFILE_UNSUPPORTED');
      const inputCapabilities = inputPath
        ? parseLangChainInputProfile(selected?.inputs)
        : undefined;
      const resultProfile = selected?.result_profile;
      if (resultProfile !== undefined && typeof resultProfile !== 'string')
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      const resultFormats = selected?.result_formats;
      if (
        resultFormats !== undefined &&
        (!Array.isArray(resultFormats) ||
          resultFormats.some(value => typeof value !== 'string'))
      )
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      const capabilities: LangChainCapabilities = {
        assistantId: selectedId,
        ...(selected
          ? {
              aguiPath:
                inputPath ||
                (rawPath === '/ag-ui/deep' ? '/ag-ui/deep' : '/ag-ui'),
            }
          : {}),
        ...(inputCapabilities ? { inputCapabilities } : {}),
        ...(resultProfile ? { resultProfile } : {}),
        ...(Array.isArray(resultFormats)
          ? { resultFormats: resultFormats as string[] }
          : {}),
      };
      if (
        (rawPath === '/ag-ui/deep' || resultProfile !== undefined) &&
        !supportsResultArtifacts(capabilities)
      )
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      return capabilities;
    }
  );
}

export async function getPhase4Result(
  config: LangChainConfig,
  threadId: string,
  nativeRunId: string,
  signal?: AbortSignal
): Promise<AgentDeliverables> {
  requireIds(threadId, nativeRunId);
  const result = await withRequest(
    config,
    `/phase4/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(nativeRunId)}/result`,
    { method: 'GET' },
    signal,
    JSON_TIMEOUT_MS,
    (response, upstreamSignal) =>
      readJSON(response, upstreamSignal, false, MAX_RESULT_MANIFEST_BYTES)
  );
  try {
    const manifest = parseAgentDeliverables(result);
    if (manifest.threadId !== threadId || manifest.runId !== nativeRunId)
      throw new Error();
    return manifest;
  } catch {
    throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
  }
}

export async function getPhase4Artifact(
  config: LangChainConfig,
  threadId: string,
  nativeRunId: string,
  artifactId: 'report' | 'data',
  signal?: AbortSignal
): Promise<{ bytes: Uint8Array; contentType: string }> {
  requireIds(threadId, nativeRunId);
  return withRequest(
    config,
    `/phase4/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(nativeRunId)}/artifacts/${artifactId}`,
    { method: 'GET' },
    signal,
    JSON_TIMEOUT_MS,
    async (response, upstreamSignal) => {
      const contentType = response.headers
        .get('content-type')
        ?.split(';')[0]
        .trim();
      if (contentType !== 'text/markdown' && contentType !== 'text/csv')
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      return {
        bytes: await readBytes(
          response,
          upstreamSignal,
          MAX_RESULT_ARTIFACT_BYTES
        ),
        contentType,
      };
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
  let aguiPath: NonNullable<LangChainCapabilities['aguiPath']> = '/ag-ui';
  let inputCapabilities: AgentInputCapabilities | undefined;
  if (
    config.assistantId !== undefined ||
    config.resultProfileEnabled !== undefined
  ) {
    const capabilities = await getCapabilities(config, turn.signal);
    if (
      config.assistantId !== undefined &&
      capabilities.assistantId !== config.assistantId
    )
      throw new LangChainUpstreamError('INVALID_REQUEST');
    if (
      (config.resultProfileEnabled === false &&
        !capabilities.inputCapabilities) ||
      supportsResultArtifacts(capabilities) !==
        (config.resultProfileEnabled === true)
    )
      throw new LangChainUpstreamError('INVALID_REQUEST');
    aguiPath = capabilities.aguiPath ?? '/ag-ui';
    inputCapabilities = capabilities.inputCapabilities;
  }
  validateLangChainTurnInput(inputCapabilities, turn.content, turn.inputFiles);
  const body = JSON.stringify({
    threadId: turn.threadId,
    runId: turn.runId,
    messages: [{ id: turn.messageId, role: 'user', content: turn.content }],
    state: {},
    tools: [],
    context: [],
    forwardedProps: inputCapabilities
      ? {
          agentifuiInput: {
            profile: LANGCHAIN_INPUT_PROFILE,
            attachments: turn.inputFiles!.map(({ fileId, slotKey }) => ({
              fileId,
              slotKey,
            })),
          },
        }
      : {},
  });
  if (Buffer.byteLength(body, 'utf8') > 64 * 1024) {
    throw new LangChainUpstreamError('INVALID_REQUEST');
  }
  const request = requestConfig(config, aguiPath);
  await turn.beforeDispatch?.();
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
    turn.onDispatch?.();
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
