import {
  type AgentAttachmentSlot,
  type AgentInputCapabilities,
  type AgentInputField,
  type InputFileType,
} from '@agentifui/shared';
import { createHash } from 'node:crypto';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const count = (value: unknown, fallback?: number): number | undefined =>
  value === undefined
    ? fallback
    : Number.isSafeInteger(value) && Number(value) >= 0
      ? Number(value)
      : undefined;
const stringList = (value: unknown): string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value
    : [];
const MIB = 1024 * 1024;
const DEFAULT_MIB: Record<InputFileType, number> = {
  document: 15,
  image: 10,
  audio: 50,
  video: 100,
  custom: 15,
};
const SYSTEM_LIMIT: Record<InputFileType, string> = {
  document: 'file_size_limit',
  image: 'image_file_size_limit',
  audio: 'audio_file_size_limit',
  video: 'video_file_size_limit',
  custom: 'file_size_limit',
};

export function unavailableInputCapabilities(
  reason = 'INPUT_CAPABILITIES_UNAVAILABLE',
  mode: AgentInputCapabilities['mode'] = 'conversation'
): AgentInputCapabilities {
  return {
    version: 1,
    status: 'unavailable',
    reason,
    mode,
    text: { enabled: false, required: false, target: 'query' },
    fields: [],
    attachmentSlots: [],
  };
}

export function normalizeDifyInputCapabilities(
  parameters: unknown,
  appType = 'chatbot',
  platformMaxBytes = 16 * MIB - 64 * 1024,
  taskInput?: { text_variable?: string | null }
): AgentInputCapabilities {
  const task = ['workflow', 'text-generation', 'completion'].includes(appType);
  const result: AgentInputCapabilities = {
    version: 1,
    status: 'ready',
    mode: task ? 'task' : 'conversation',
    text: { enabled: !task, required: !task, target: 'query' },
    fields: [],
    attachmentSlots: [],
  };
  if (
    !parameters ||
    typeof parameters !== 'object' ||
    Array.isArray(parameters)
  )
    return unavailableInputCapabilities(undefined, result.mode);
  const data = record(parameters);
  const system = record(data.system_parameters);
  const fail = (unsupported = false) => {
    result.status = unsupported ? 'unsupported' : 'unavailable';
    result.reason = unsupported
      ? 'INPUT_FIELD_UNSUPPORTED'
      : 'INPUT_CAPABILITIES_INVALID';
  };
  const addSlot = (
    key: string,
    target: 'files' | 'inputs',
    config: RecordValue,
    single = false
  ) => {
    const maximum = single
      ? 1
      : count(
          config.max_length ?? config.number_limits,
          target === 'files' ? 3 : undefined
        );
    const minimum = config.required === true ? 1 : 0;
    const upstreamMethods = stringList(
      config.allowed_file_upload_methods ?? config.transfer_methods
    ).filter((method): method is 'local_file' | 'remote_url' =>
      ['local_file', 'remote_url'].includes(method)
    );
    const methods = upstreamMethods.filter(method => method === 'local_file');
    const types = stringList(config.allowed_file_types).filter(
      (type): type is InputFileType => Object.hasOwn(DEFAULT_MIB, type)
    );
    const extensions = [
      ...new Set(
        stringList(config.allowed_file_extensions)
          .map(extension => extension.trim().replace(/^\./, '').toLowerCase())
          .filter(Boolean)
      ),
    ];
    const maxBytesByType: AgentAttachmentSlot['maxBytesByType'] = {};
    for (const type of types) {
      const upstreamLimit = system[SYSTEM_LIMIT[type]] ?? DEFAULT_MIB[type];
      const fieldLimit = config.max_file_size_mb ?? upstreamLimit;
      if (
        [upstreamLimit, fieldLimit].some(
          limit =>
            typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0
        )
      ) {
        fail();
        return;
      }
      maxBytesByType[type] = Math.floor(
        Math.min(
          Number(upstreamLimit) * MIB,
          Number(fieldLimit) * MIB,
          platformMaxBytes
        )
      );
    }
    if (
      maximum === undefined ||
      maximum < minimum ||
      !upstreamMethods.length ||
      !types.length ||
      (types.includes('custom') && !extensions.length) ||
      result.attachmentSlots.some(
        slot => slot.key === key && slot.target === target
      )
    ) {
      fail();
      return;
    }
    if (minimum > 0 && !methods.includes('local_file')) fail(true);
    result.attachmentSlots.push({
      key,
      label: typeof config.label === 'string' ? config.label : key,
      target,
      multiple: !single,
      minCount: minimum,
      maxCount: maximum,
      methods,
      allowedTypes: types,
      extensions,
      maxBytesByType,
    });
  };
  const upload = record(data.file_upload);
  if (upload.enabled === true) addSlot('files', 'files', upload);
  else if (record(upload.image).enabled === true) {
    addSlot('files', 'files', {
      ...record(upload.image),
      allowed_file_types: ['image'],
    });
  }
  if (
    data.user_input_form !== undefined &&
    !Array.isArray(data.user_input_form)
  )
    fail();
  const seen = new Set<string>();
  for (const item of Array.isArray(data.user_input_form)
    ? data.user_input_form
    : []) {
    const entries = Object.entries(record(item));
    if (entries.length !== 1) {
      fail();
      continue;
    }
    const [type, raw] = entries[0];
    const config = record(raw);
    const key = config.variable;
    if (typeof key !== 'string' || !key || seen.has(key)) {
      fail();
      continue;
    }
    seen.add(key);
    if (type === 'file' || type === 'file-list') {
      addSlot(key, 'inputs', config, type === 'file');
      continue;
    }
    if (!['text-input', 'paragraph', 'number', 'select'].includes(type)) {
      if (config.required === true) fail(true);
      continue;
    }
    const field: AgentInputField = {
      key,
      label: typeof config.label === 'string' ? config.label : key,
      type: type as AgentInputField['type'],
      required: config.required === true,
    };
    if (
      typeof config.default === 'string' ||
      typeof config.default === 'number'
    )
      field.default = config.default;
    if (type === 'select') field.options = stringList(config.options);
    if (type === 'number') {
      for (const constraint of ['min', 'max', 'step', 'precision'] as const) {
        if (config[constraint] === undefined) continue;
        const value = config[constraint];
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          (constraint === 'step' && value <= 0) ||
          (constraint === 'precision' &&
            (!Number.isSafeInteger(value) || value < 0))
        )
          fail();
        else field[constraint] = value;
      }
      if (
        field.min !== undefined &&
        field.max !== undefined &&
        field.min > field.max
      )
        fail();
    }
    if (type === 'text-input' || type === 'paragraph') {
      const maxLength = count(config.max_length);
      if (config.max_length !== undefined && maxLength === undefined) fail();
      field.maxLength = maxLength;
    }
    result.fields.push(field);
  }
  if (task) {
    const candidates = result.fields.filter(field =>
      ['text-input', 'paragraph'].includes(field.type)
    );
    const variable = taskInput?.text_variable;
    const field =
      variable === undefined
        ? candidates.length === 1
          ? candidates[0]
          : undefined
        : candidates.find(candidate => candidate.key === variable);
    if (variable !== undefined && variable !== null && !field) {
      result.status = 'unavailable';
      result.reason = 'TASK_TEXT_MAPPING_INVALID';
    } else if (field && variable !== null && result.status === 'ready') {
      result.text = {
        enabled: true,
        required: field.required,
        target: field.key,
      };
    }
  }
  return result;
}

interface DifyInputTarget {
  serviceInstanceId?: string;
  difyApiUrl: string;
  difyApiKey: string;
  credentialVersion?: string;
  appType?: string;
  taskInput?: { text_variable?: string | null };
}
const cache = new Map<
  string,
  { expires: number; capabilities: AgentInputCapabilities }
>();
const inflight = new Map<string, Promise<AgentInputCapabilities>>();
let generation = 0;

export function clearDifyInputCapabilitiesCache(): void {
  generation += 1;
  cache.clear();
  inflight.clear();
}

export async function resolveDifyInputCapabilities(
  target: DifyInputTarget
): Promise<AgentInputCapabilities> {
  const configuredLimit = process.env.DIFY_UPLOAD_MAX_BYTES;
  const bodyLimit =
    configuredLimit === undefined ? 16 * MIB : Number(configuredLimit);
  const platformMaxBytes =
    bodyLimit - Math.min(64 * 1024, Math.ceil(bodyLimit / 4));
  const key = createHash('sha256')
    .update(
      JSON.stringify([
        target.serviceInstanceId,
        target.difyApiUrl,
        target.difyApiKey,
        target.credentialVersion,
        target.appType,
        target.taskInput,
        platformMaxBytes,
      ])
    )
    .digest('hex');
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.capabilities;
  if (inflight.has(key)) return inflight.get(key)!;
  const startedGeneration = generation;
  const pending = (async () => {
    try {
      const response = await fetch(
        `${target.difyApiUrl.replace(/\/+$/, '')}/parameters`,
        {
          headers: { Authorization: `Bearer ${target.difyApiKey}` },
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          cache: 'no-store',
        }
      );
      if (!response.ok) return unavailableInputCapabilities();
      const capabilities = normalizeDifyInputCapabilities(
        await response.json(),
        target.appType,
        platformMaxBytes,
        target.taskInput
      );
      if (startedGeneration === generation) {
        if (cache.size >= 512) cache.delete(cache.keys().next().value!);
        cache.set(key, { capabilities, expires: Date.now() + 60000 });
      }
      return capabilities;
    } catch {
      return unavailableInputCapabilities();
    } finally {
      if (startedGeneration === generation) inflight.delete(key);
    }
  })();
  inflight.set(key, pending);
  return pending;
}
