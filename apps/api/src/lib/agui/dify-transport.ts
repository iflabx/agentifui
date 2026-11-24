import { type InputFileType, validateInputFileCount } from '@agentifui/shared';

import type { AgentApp } from '../agent-app';
import { normalizeDifyInputCapabilities } from '../dify-input-capabilities';

export interface DifyInputFile {
  type: InputFileType;
  transfer_method: 'local_file';
  upload_file_id: string;
}

export type DifyChatInputs = Record<
  string,
  string | number | DifyInputFile | DifyInputFile[]
>;

export class DifyRuntimeError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number
  ) {
    super(code);
  }
}

const MAX_FRAME_BYTES = 256 * 1024;
const MAX_STREAM_BYTES = 2 * 1024 * 1024;

function endpoint(app: AgentApp, path: string) {
  const base = new URL(app.baseUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !app.apiKey.trim() ||
    /[\r\n]/.test(app.apiKey)
  )
    throw new DifyRuntimeError('DIFY_CONFIG_INVALID');
  return {
    url: `${base.toString().replace(/\/+$/, '')}/${path}`,
    headers: { Authorization: `Bearer ${app.apiKey}` },
  };
}

async function checkedFetch(app: AgentApp, path: string, init: RequestInit) {
  const target = endpoint(app, path);
  const response = await fetch(target.url, {
    ...init,
    headers: { ...target.headers, ...init.headers },
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new DifyRuntimeError('DIFY_UPSTREAM_HTTP_ERROR', response.status);
  }
  return response;
}

async function readDifyApplication(
  app: AgentApp,
  path: 'info' | 'parameters' | 'files/upload',
  form?: FormData
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const abort = () => {
    void reader?.cancel().catch(() => undefined);
  };
  controller.signal.addEventListener('abort', abort, { once: true });
  try {
    const response = await checkedFetch(app, path, {
      method: form ? 'POST' : 'GET',
      body: form,
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.body) throw new DifyRuntimeError('DIFY_INFO_INVALID');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      controller.signal.throwIfAborted();
      const chunk = await reader.read();
      controller.signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_FRAME_BYTES)
        throw new DifyRuntimeError('DIFY_INFO_INVALID');
      chunks.push(chunk.value);
    }
    const info: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    );
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
      throw new DifyRuntimeError('DIFY_INFO_INVALID');
    }
    return info as Record<string, unknown>;
  } catch (error) {
    if (error instanceof DifyRuntimeError) throw error;
    throw new DifyRuntimeError(
      controller.signal.aborted
        ? 'DIFY_UPSTREAM_TIMEOUT'
        : 'DIFY_INFO_UNAVAILABLE'
    );
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', abort);
    void reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
    controller.abort();
  }
}

async function readDifyChatbotParameters(app: AgentApp) {
  if ((await readDifyApplication(app, 'info')).mode !== 'chat')
    throw new DifyRuntimeError('DIFY_MODE_UNSUPPORTED');
  const parameters = await readDifyApplication(app, 'parameters');
  if (!Array.isArray(parameters.user_input_form))
    throw new DifyRuntimeError('DIFY_PARAMETERS_UNSUPPORTED');
  return parameters;
}

export async function resolveDifyChatbotInputs(
  app: AgentApp,
  platformMaxBytes: number
) {
  const parameters = await readDifyChatbotParameters(app);
  const upload = parameters.file_upload;
  let capabilities = normalizeDifyInputCapabilities(
    parameters,
    'chatbot',
    platformMaxBytes
  );
  if (
    capabilities.status !== 'ready' &&
    upload &&
    typeof upload === 'object' &&
    !Array.isArray(upload) &&
    Reflect.get(upload, 'required') !== true &&
    !capabilities.attachmentSlots.some(slot => slot.target === 'files')
  ) {
    const imageOnly = normalizeDifyInputCapabilities(
      { ...parameters, file_upload: { image: Reflect.get(upload, 'image') } },
      'chatbot',
      platformMaxBytes
    );
    capabilities =
      imageOnly.status === 'ready'
        ? imageOnly
        : normalizeDifyInputCapabilities(
            { ...parameters, file_upload: undefined },
            'chatbot',
            platformMaxBytes
          );
  }
  capabilities.fields = capabilities.fields.filter(
    field => !field.key.startsWith('agentifui_user_')
  );
  return capabilities;
}

export async function uploadDifyChatbotFile(
  app: AgentApp,
  userId: string,
  file: File
): Promise<string> {
  const form = new FormData();
  form.set('file', file);
  form.set('user', userId);
  const { id } = await readDifyApplication(app, 'files/upload', form);
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,255}$/.test(id))
    throw new DifyRuntimeError('DIFY_UPLOAD_RESPONSE_INVALID');
  return id;
}

export async function verifyDifyChatbot(
  app: AgentApp,
  inputs: DifyChatInputs = {},
  files: readonly DifyInputFile[] = []
): Promise<void> {
  const parameters = await readDifyChatbotParameters(app);
  const capabilities = normalizeDifyInputCapabilities(parameters, 'chatbot');
  for (const slot of capabilities.attachmentSlots) {
    const value = slot.target === 'files' ? files : inputs[slot.key];
    const count = Array.isArray(value)
      ? value.length
      : typeof value === 'object' && value !== null
        ? 1
        : 0;
    if (validateInputFileCount(slot, count))
      throw new DifyRuntimeError('DIFY_PARAMETERS_UNSUPPORTED');
  }
  if (!Array.isArray(parameters.user_input_form))
    throw new DifyRuntimeError('DIFY_PARAMETERS_UNSUPPORTED');
  for (const field of parameters.user_input_form) {
    if (!field || typeof field !== 'object' || Array.isArray(field))
      throw new DifyRuntimeError('DIFY_PARAMETERS_UNSUPPORTED');
    for (const value of Object.values(field)) {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new DifyRuntimeError('DIFY_PARAMETERS_UNSUPPORTED');
      const parameter = value as Record<string, unknown>;
      if (
        parameter.required === true &&
        (parameter.default === undefined ||
          parameter.default === null ||
          parameter.default === '') &&
        !(
          typeof parameter.variable === 'string' &&
          Object.hasOwn(inputs, parameter.variable) &&
          inputs[parameter.variable] !== '' &&
          (!Array.isArray(inputs[parameter.variable]) ||
            (inputs[parameter.variable] as DifyInputFile[]).length > 0)
        )
      )
        throw new DifyRuntimeError('DIFY_PARAMETERS_UNSUPPORTED');
    }
  }
}

export async function* parseDifyRuntimeStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let line = '';
  let data: string[] = [];
  let frameBytes = 0;
  let streamBytes = 0;
  let skipLineFeed = false;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  const frame = () => {
    const payload = data.join('\n');
    data = [];
    frameBytes = 0;
    if (!payload) return;
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      throw new DifyRuntimeError('DIFY_STREAM_INVALID');
    }
    if (
      !event ||
      typeof event !== 'object' ||
      Array.isArray(event) ||
      typeof (event as Record<string, unknown>).event !== 'string'
    )
      throw new DifyRuntimeError('DIFY_STREAM_INVALID');
    return event as Record<string, unknown>;
  };
  function* text(value: string) {
    for (const character of value) {
      if (skipLineFeed) {
        skipLineFeed = false;
        if (character === '\n') continue;
      }
      if (character === '\n' || character === '\r') {
        if (!line) {
          const event = frame();
          if (event) yield event;
        } else if (line.startsWith('data:')) {
          const value = line.slice(5);
          data.push(value.startsWith(' ') ? value.slice(1) : value);
        }
        line = '';
        skipLineFeed = character === '\r';
      } else {
        line += character;
        frameBytes += Buffer.byteLength(character, 'utf8');
        if (frameBytes > MAX_FRAME_BYTES)
          throw new DifyRuntimeError('DIFY_STREAM_LIMIT');
      }
    }
  }
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      streamBytes += chunk.value.byteLength;
      if (streamBytes > MAX_STREAM_BYTES)
        throw new DifyRuntimeError('DIFY_STREAM_LIMIT');
      yield* text(decoder.decode(chunk.value, { stream: true }));
    }
    yield* text(decoder.decode());
    if (line || data.length)
      throw new DifyRuntimeError('DIFY_STREAM_INCOMPLETE');
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function* streamDifyChatbot(input: {
  app: AgentApp;
  userId: string;
  content: string;
  inputs: DifyChatInputs;
  files?: DifyInputFile[];
  nativeConversationId: string | null;
  beforeDispatch: () => Promise<void>;
  onDispatch: () => void;
}): AsyncGenerator<Record<string, unknown>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let response: Response | undefined;
  try {
    await input.beforeDispatch();
    timer = setTimeout(() => controller.abort(), 150000);
    input.onDispatch();
    response = await checkedFetch(input.app, 'chat-messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        query: input.content,
        inputs: input.inputs,
        ...(input.files?.length ? { files: input.files } : {}),
        user: input.userId,
        conversation_id: input.nativeConversationId ?? '',
        response_mode: 'streaming',
        auto_generate_name: false,
      }),
    });
    if (
      !response.body ||
      response.headers
        .get('content-type')
        ?.split(';')[0]
        .trim()
        .toLowerCase() !== 'text/event-stream'
    )
      throw new DifyRuntimeError('DIFY_STREAM_INVALID');
    yield* parseDifyRuntimeStream(response.body, controller.signal);
  } catch (error) {
    if (error instanceof DifyRuntimeError) throw error;
    if (controller.signal.aborted)
      throw new DifyRuntimeError('DIFY_UPSTREAM_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
    if (response?.body && !response.body.locked)
      void response.body.cancel().catch(() => undefined);
    controller.abort();
  }
}

export class DifyChatIdentity {
  private conversationId: string | null;
  private messageId?: string;
  private taskId?: string;

  constructor(nativeConversationId: string | null) {
    this.conversationId = nativeConversationId;
  }

  accept(event: Record<string, unknown>) {
    const text = ['message', 'message_replace', 'message_end'].includes(
      String(event.event)
    );
    const messageId = event.message_id ?? (text ? event.id : undefined);
    const fields = [event.conversation_id, messageId, event.task_id];
    if (
      fields.some(
        value =>
          value !== undefined &&
          (typeof value !== 'string' ||
            !value ||
            value.length > 255 ||
            /[\x00-\x1f\x7f]/.test(value))
      )
    )
      throw new DifyRuntimeError('DIFY_IDENTITY_INVALID');
    if (
      (text &&
        (event.conversation_id === undefined || messageId === undefined)) ||
      (event.conversation_id !== undefined &&
        this.conversationId !== null &&
        event.conversation_id !== this.conversationId) ||
      (messageId !== undefined &&
        this.messageId !== undefined &&
        messageId !== this.messageId) ||
      (event.task_id !== undefined &&
        this.taskId !== undefined &&
        event.task_id !== this.taskId) ||
      (text &&
        event.id !== undefined &&
        event.message_id !== undefined &&
        event.id !== event.message_id)
    )
      throw new DifyRuntimeError('DIFY_IDENTITY_CHANGED');
    if (text) {
      this.conversationId = event.conversation_id as string;
      this.messageId = messageId as string;
      if (event.task_id !== undefined) this.taskId = event.task_id as string;
    }
    return { conversationId: this.conversationId, messageId: this.messageId };
  }
}
