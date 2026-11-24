import {
  type AgentAttachmentSlot,
  type AgentInputCapabilities,
  type AgentInputField,
  inputFileType,
  validateInputFile,
  validateInputFileCount,
} from '@agentifui/shared';

import { type AgentApp, AgentAppError } from './agent-app';
import { AgentPolicyError } from './agent-backends';
import {
  type AgentInputFileReference,
  agentInputFileScope,
  resolveAgentInputFiles,
} from './agent-input-file-repository';
import {
  type DifyChatInputs,
  type DifyInputFile,
  DifyRuntimeError,
  resolveDifyChatbotInputs,
} from './agui/dify-transport';
import { unavailableInputCapabilities } from './dify-input-capabilities';
import { assertDifyUploadStorage } from './dify-upload-archive';
import {
  readLangChainInputFileMetadata,
  resolveLangChainInputCapabilities,
} from './langchain/input-files';

type Scalar = string | number;

function invalid(code: string): never {
  throw new AgentPolicyError(400, code);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function allowedKey(key: string) {
  return (
    /^[\w.-]{1,128}$/.test(key) &&
    !key.startsWith('agentifui_user_') &&
    !Object.hasOwn(Object.prototype, key) &&
    key !== 'prototype'
  );
}

export function agentUploadBodyLimit() {
  return Number(process.env.DIFY_UPLOAD_MAX_BYTES ?? 16 * 1024 * 1024);
}

export function parseAgentRunInputs(body: Record<string, unknown>) {
  const fields: [string, Scalar][] = [];
  if (body.inputs !== undefined) {
    if (!isObject(body.inputs)) invalid('INPUT_FIELDS_INVALID');
    if (!Object.keys(body.inputs).length) invalid('INPUT_FIELDS_INVALID');
    for (const [key, value] of Object.entries(body.inputs)) {
      if (!allowedKey(key)) invalid('INPUT_FIELD_INVALID');
      if (
        typeof value !== 'string' &&
        !(typeof value === 'number' && Number.isFinite(value))
      )
        invalid('INPUT_FIELD_INVALID');
      fields.push([key, value]);
    }
  }
  const attachments: AgentInputFileReference[] = [];
  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments))
      invalid('INPUT_FILE_REFERENCE_INVALID');
    const seen = new Set<string>();
    for (const ref of body.attachments) {
      if (
        !isObject(ref) ||
        Object.keys(ref).length !== 2 ||
        typeof ref.fileId !== 'string' ||
        !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(ref.fileId) ||
        typeof ref.slotKey !== 'string' ||
        !allowedKey(ref.slotKey)
      )
        invalid('INPUT_FILE_REFERENCE_INVALID');
      const fileId = ref.fileId.toLowerCase();
      if (seen.has(fileId)) invalid('INPUT_FILE_DUPLICATE');
      seen.add(fileId);
      attachments.push({ fileId, slotKey: ref.slotKey });
    }
  }
  return {
    ...(fields.length ? { inputs: Object.fromEntries(fields) } : {}),
    ...(attachments.length ? { attachments } : {}),
  };
}

export async function resolveSharedAgentInputCapabilities(
  app: AgentApp
): Promise<AgentInputCapabilities> {
  if (app.backendType !== 'dify') return resolveLangChainInputCapabilities(app);
  try {
    const limit = agentUploadBodyLimit();
    const capabilities = await resolveDifyChatbotInputs(
      app,
      limit - Math.min(64 * 1024, Math.ceil(limit / 4))
    );
    const inputKeys = new Set(
      capabilities.attachmentSlots
        .filter(slot => slot.target === 'inputs')
        .map(slot => slot.key)
    );
    for (const slot of capabilities.attachmentSlots) {
      if (slot.target !== 'files' || !inputKeys.has(slot.key)) continue;
      let publicKey = 'message.files';
      while (inputKeys.has(publicKey)) publicKey += '.files';
      slot.key = publicKey;
    }
    const keys = capabilities.attachmentSlots.map(slot => slot.key);
    if (
      new Set(keys).size !== keys.length ||
      keys.some(key => !allowedKey(key)) ||
      capabilities.fields.some(field => !allowedKey(field.key))
    )
      return {
        ...unavailableInputCapabilities('INPUT_FIELD_UNSUPPORTED'),
        status: 'unsupported',
      };
    if (
      capabilities.status === 'ready' &&
      capabilities.attachmentSlots.some(slot =>
        slot.methods.includes('local_file')
      )
    ) {
      try {
        assertDifyUploadStorage();
      } catch {
        if (capabilities.attachmentSlots.some(slot => slot.minCount > 0))
          return unavailableInputCapabilities(
            'DIFY_UPLOAD_STORAGE_UNAVAILABLE'
          );
        capabilities.attachmentSlots = [];
      }
    }
    return capabilities;
  } catch (error) {
    if (
      error instanceof DifyRuntimeError &&
      ['DIFY_MODE_UNSUPPORTED', 'DIFY_PARAMETERS_UNSUPPORTED'].includes(
        error.code
      )
    )
      return {
        ...unavailableInputCapabilities(error.code),
        status: 'unsupported',
      };
    return unavailableInputCapabilities();
  }
}

export function requireReadyAgentInput(capabilities: AgentInputCapabilities) {
  if (capabilities.status !== 'ready')
    throw new AgentPolicyError(
      capabilities.status === 'unsupported' ? 409 : 503,
      capabilities.reason ?? 'INPUT_CAPABILITIES_UNAVAILABLE'
    );
}

export function validateAgentInputFile(
  slot: AgentAttachmentSlot,
  file: { name: string; size: number; type: string }
) {
  const issue = validateInputFile(slot, file);
  if (issue) invalid(issue);
}

function normalizeField(field: AgentInputField, value: Scalar): Scalar {
  if (field.type === 'number') {
    const number =
      typeof value === 'number'
        ? value
        : /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
          ? Number(value)
          : NaN;
    const isNearInteger = (candidate: number) =>
      Math.abs(Math.round(candidate) - candidate) <= 1e-8;
    if (
      !Number.isFinite(number) ||
      (field.min !== undefined && number < field.min) ||
      (field.max !== undefined && number > field.max) ||
      (field.step !== undefined &&
        !isNearInteger((number - (field.min ?? 0)) / field.step)) ||
      (field.precision !== undefined &&
        field.precision < 16 &&
        !isNearInteger(number * 10 ** field.precision))
    )
      invalid('INPUT_FIELD_INVALID');
    return number;
  }
  if (
    typeof value !== 'string' ||
    (field.type === 'select' && !field.options?.includes(value)) ||
    (field.maxLength !== undefined && value.length > field.maxLength)
  )
    invalid('INPUT_FIELD_INVALID');
  return value;
}

export async function prepareAgentRunInput(input: {
  app: AgentApp;
  userId: string;
  capabilities: AgentInputCapabilities;
  content: string;
  agui: boolean;
  request: ReturnType<typeof parseAgentRunInputs>;
  trusted: Record<string, string>;
}) {
  const { app, userId, capabilities, content, agui, request, trusted } = input;
  requireReadyAgentInput(capabilities);
  const isDify = app.backendType === 'dify';
  const hasLangChainFiles = !isDify && capabilities.attachmentSlots.length > 0;
  if (!agui && (hasLangChainFiles || request.inputs || request.attachments))
    throw new AgentPolicyError(409, 'AGENT_PROTOCOL_REQUIRED');
  if (app.resultProfileEnabled === false && !isDify && !hasLangChainFiles)
    throw new AgentPolicyError(409, 'AGENT_RESULT_PROFILE_DISABLED');
  if (request.inputs && !isDify) invalid('INPUT_FIELDS_UNSUPPORTED');
  const refs = request.attachments ?? [];
  if (
    (!content.trim() &&
      (capabilities.text.required || (!refs.length && !request.inputs))) ||
    (content.trim() && !capabilities.text.enabled)
  )
    invalid('INPUT_TEXT_INVALID');

  const fields = new Map(capabilities.fields.map(field => [field.key, field]));
  const difyInputs: DifyChatInputs = { ...trusted };
  for (const [key, value] of Object.entries(request.inputs ?? {})) {
    const field = fields.get(key);
    if (!field) invalid('INPUT_FIELD_INVALID');
    if (typeof value === 'string' && !value.trim()) continue;
    difyInputs[key] = normalizeField(field, value);
  }
  for (const field of fields.values()) {
    if (
      field.required &&
      (field.default === undefined || field.default === '') &&
      !Object.hasOwn(difyInputs, field.key)
    )
      invalid('INPUT_FIELD_REQUIRED');
  }

  const slots = new Map(
    capabilities.attachmentSlots.map(slot => [slot.key, slot])
  );
  const counts = new Map<string, number>();
  for (const ref of refs) {
    if (!slots.has(ref.slotKey)) invalid('INPUT_FILE_SLOT_INVALID');
    counts.set(ref.slotKey, (counts.get(ref.slotKey) ?? 0) + 1);
  }
  for (const slot of slots.values()) {
    const issue = validateInputFileCount(slot, counts.get(slot.key) ?? 0);
    if (issue) invalid(issue);
  }
  const files = await resolveAgentInputFiles(
    agentInputFileScope(app, userId),
    refs
  );
  if (!isDify)
    await Promise.all(
      files.map(async file => {
        try {
          const remote = await readLangChainInputFileMetadata(
            app,
            userId,
            file.nativeId
          );
          if (
            remote.slotKey !== file.slotKey ||
            remote.name !== file.name ||
            remote.size !== file.size ||
            remote.type !== file.type
          )
            throw new AgentPolicyError(409, 'INPUT_FILE_CHANGED');
        } catch (error) {
          if (error instanceof AgentAppError && error.statusCode === 404)
            throw new AgentPolicyError(410, 'INPUT_FILE_UNAVAILABLE');
          if (error instanceof AgentAppError)
            throw new AgentPolicyError(error.statusCode, error.code);
          throw error;
        }
      })
    );
  const difyFiles: DifyInputFile[] = [];
  const difySlotFiles = new Map<string, DifyInputFile[]>();
  const inputFiles: AgentInputFileReference[] = [];
  for (const file of files) {
    const slot = slots.get(file.slotKey)!;
    validateAgentInputFile(slot, file);
    if (!isDify) {
      inputFiles.push({ fileId: file.nativeId, slotKey: file.slotKey });
      continue;
    }
    const type = inputFileType(file.name, file.type);
    const native: DifyInputFile = {
      type: slot.allowedTypes.includes(type) ? type : 'custom',
      transfer_method: 'local_file',
      upload_file_id: file.nativeId,
    };
    if (slot.target === 'files') difyFiles.push(native);
    else {
      const values = difySlotFiles.get(slot.key) ?? [];
      values.push(native);
      difySlotFiles.set(slot.key, values);
      difyInputs[slot.key] = slot.multiple === false ? native : values;
    }
  }
  return {
    inputs: difyInputs,
    ...(difyFiles.length ? { files: difyFiles } : {}),
    ...(hasLangChainFiles ? { inputFiles } : {}),
  };
}
