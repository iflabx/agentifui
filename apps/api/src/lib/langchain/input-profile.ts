import {
  type AgentInputCapabilities,
  validateInputFileCount,
} from '@agentifui/shared';

import { LangChainUpstreamError } from './ag-ui';

export const LANGCHAIN_INPUT_PROFILE = 'agentifui-input-files/1';
export const MAX_LANGCHAIN_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_FILES = 16;

export type LangChainInputPath =
  '/ag-ui/attachments' | '/ag-ui/attachments/pair';

export interface LangChainInputFileRef {
  fileId: string;
  slotKey: string;
}

const MIME_TYPES = new Map([
  ['txt', 'text/plain'],
  ['md', 'text/markdown'],
  ['csv', 'text/csv'],
]);

export function langChainInputFileMime(extension: string): string | undefined {
  return MIME_TYPES.get(extension);
}

export function langChainInputPath(
  assistantId: string
): LangChainInputPath | undefined {
  if (assistantId === 'attachment-agent') return '/ag-ui/attachments';
  if (assistantId === 'attachment-pair-agent') return '/ag-ui/attachments/pair';
  return undefined;
}

export function isLangChainInputFileId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function langChainInputCapabilities(
  status: AgentInputCapabilities['status'],
  reason?: string
): AgentInputCapabilities {
  return {
    version: 1,
    status,
    ...(reason ? { reason } : {}),
    mode: 'conversation',
    text: {
      enabled: status === 'ready',
      required: status === 'ready',
      target: 'content',
    },
    fields: [],
    attachmentSlots: [],
  };
}

export function parseLangChainInputProfile(
  raw: unknown
): AgentInputCapabilities {
  const input = asRecord(raw);
  const text = asRecord(input?.text);
  const slots = input?.attachmentSlots;
  const slot =
    Array.isArray(slots) && slots.length === 1 ? asRecord(slots[0]) : undefined;
  const minCount = slot?.minCount;
  const maxCount = slot?.maxCount;
  const maxBytes = slot?.maxBytesPerFile;
  const extensions = slot?.extensions;
  if (
    input?.profile !== LANGCHAIN_INPUT_PROFILE ||
    typeof text?.enabled !== 'boolean' ||
    typeof text.required !== 'boolean' ||
    (!text.enabled && text.required) ||
    slot?.key !== 'reference' ||
    typeof minCount !== 'number' ||
    !Number.isSafeInteger(minCount) ||
    minCount < 0 ||
    slot.required !== minCount > 0 ||
    typeof maxCount !== 'number' ||
    !Number.isSafeInteger(maxCount) ||
    maxCount < Math.max(1, minCount) ||
    maxCount > MAX_INPUT_FILES ||
    !Array.isArray(slot.methods) ||
    slot.methods.length !== 1 ||
    slot.methods[0] !== 'local_file' ||
    typeof maxBytes !== 'number' ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_LANGCHAIN_INPUT_BYTES ||
    !Array.isArray(extensions) ||
    !extensions.length ||
    new Set(extensions).size !== extensions.length ||
    !extensions.every(
      extension =>
        typeof extension === 'string' &&
        extension.startsWith('.') &&
        langChainInputFileMime(extension.slice(1))
    )
  ) {
    throw new LangChainUpstreamError('INPUT_PROFILE_UNSUPPORTED');
  }
  return {
    ...langChainInputCapabilities('ready'),
    text: { enabled: text.enabled, required: text.required, target: 'content' },
    attachmentSlots: [
      {
        key: slot.key,
        label: 'Reference files',
        target: 'files',
        multiple: maxCount > 1,
        minCount,
        maxCount,
        methods: ['local_file'],
        allowedTypes: ['document'],
        extensions: extensions.map(extension => extension.slice(1)),
        maxBytesByType: { document: maxBytes },
      },
    ],
  };
}

export function validateLangChainTurnInput(
  capabilities: AgentInputCapabilities | undefined,
  content: string,
  inputFiles: LangChainInputFileRef[] | undefined
): void {
  if (typeof content !== 'string' || [...content].length > 16000) {
    throw new LangChainUpstreamError('INVALID_REQUEST');
  }
  if (!capabilities) {
    if (inputFiles !== undefined || !content.trim()) {
      throw new LangChainUpstreamError('INVALID_REQUEST');
    }
    return;
  }
  const slot = capabilities.attachmentSlots[0];
  if (
    !Array.isArray(inputFiles) ||
    validateInputFileCount(slot, inputFiles.length) ||
    (capabilities.text.required && !content.trim()) ||
    (!capabilities.text.enabled && content !== '') ||
    (!content.trim() && !inputFiles.length)
  ) {
    throw new LangChainUpstreamError('INVALID_REQUEST');
  }
  const seen = new Set<string>();
  for (const ref of inputFiles) {
    if (
      !ref ||
      Object.keys(ref).length !== 2 ||
      !Object.hasOwn(ref, 'fileId') ||
      !Object.hasOwn(ref, 'slotKey') ||
      !isLangChainInputFileId(ref.fileId) ||
      ref.slotKey !== slot.key ||
      seen.has(ref.fileId)
    ) {
      throw new LangChainUpstreamError('INVALID_REQUEST');
    }
    seen.add(ref.fileId);
  }
}
