import {
  type AgentAttachmentSlot,
  inputFileType,
  validateInputFile,
  validateInputFileCount,
} from '@agentifui/shared';

import { AgentPolicyError } from '../../lib/agent-backends';
import { resolveDifyInputCapabilities } from '../../lib/dify-input-capabilities';
import { loadDifyUploadMetadata } from '../../lib/dify-upload-access';
import { isObjectRecord } from './helpers';
import type { DifyProxyRequestContext, DifyProxyTargetConfig } from './types';

function reject(code: string): never {
  throw new AgentPolicyError(400, code);
}

export async function validateDifyInputUpload(
  form: FormData,
  target: DifyProxyTargetConfig
): Promise<void> {
  const capabilities = await resolveDifyInputCapabilities(target);
  if (capabilities.status !== 'ready')
    throw new AgentPolicyError(
      503,
      capabilities.reason || 'INPUT_CAPABILITIES_UNAVAILABLE'
    );
  const files = form.getAll('file');
  if (files.length !== 1 || !(files[0] instanceof File))
    reject('INPUT_UPLOAD_INVALID');
  const file = files[0];
  const candidates = capabilities.attachmentSlots.filter(
    slot => !validateInputFile(slot, file)
  );
  if (!candidates.length) reject('INPUT_FILE_NOT_ALLOWED');
  form.delete('slotKey');
}

export async function validateDifyGenerationInput(
  body: unknown,
  context: DifyProxyRequestContext,
  target: DifyProxyTargetConfig
): Promise<void> {
  if (!target.serviceInstanceId || !isObjectRecord(body))
    reject('INPUT_BODY_INVALID');
  const capabilities = await resolveDifyInputCapabilities(target);
  if (capabilities.status !== 'ready')
    throw new AgentPolicyError(
      503,
      capabilities.reason || 'INPUT_CAPABILITIES_UNAVAILABLE'
    );
  const inputs = isObjectRecord(body.inputs) ? { ...body.inputs } : {};
  if (
    target.appType === 'chatflow' &&
    typeof body.conversation_id === 'string' &&
    body.conversation_id
  ) {
    const missingKeys = [
      ...capabilities.fields.map(field => field.key),
      ...capabilities.attachmentSlots
        .filter(slot => slot.target === 'inputs')
        .map(slot => slot.key),
    ].filter(key => !Object.hasOwn(inputs, key));
    if (missingKeys.length) {
      const url = new URL(`${target.difyApiUrl.replace(/\/+$/, '')}/messages`);
      url.searchParams.set('conversation_id', body.conversation_id);
      url.searchParams.set('user', context.actor.userId);
      url.searchParams.set('limit', '1');
      let history: unknown;
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${target.difyApiKey}` },
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if ([403, 404].includes(response.status))
          throw new AgentPolicyError(403, 'INPUT_CONVERSATION_UNAVAILABLE');
        if (!response.ok) throw new Error('History unavailable');
        history = await response.json();
      } catch (error) {
        if (error instanceof AgentPolicyError) throw error;
        throw new AgentPolicyError(503, 'INPUT_CONVERSATION_UNAVAILABLE');
      }
      const latest =
        isObjectRecord(history) && Array.isArray(history.data)
          ? history.data[0]
          : undefined;
      if (!isObjectRecord(latest) || !isObjectRecord(latest.inputs))
        throw new AgentPolicyError(503, 'INPUT_CONVERSATION_UNAVAILABLE');
      const restoreFile = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(restoreFile);
        if (!isObjectRecord(value)) return value;
        if (
          value.transfer_method === 'local_file' &&
          typeof value.related_id === 'string'
        )
          return {
            type: value.type,
            transfer_method: 'local_file',
            upload_file_id: value.related_id,
          };
        return value;
      };
      for (const key of missingKeys)
        if (Object.hasOwn(latest.inputs, key))
          inputs[key] = restoreFile(latest.inputs[key]);
      body.inputs = inputs;
    }
  }
  const seen = new Set<string>();
  const checkSlot = async (slot: AgentAttachmentSlot, value: unknown) => {
    if (slot.target === 'files' && value !== undefined && !Array.isArray(value))
      reject('INPUT_FILE_REFERENCE_INVALID');
    const files =
      value === undefined || value === null || value === ''
        ? []
        : Array.isArray(value)
          ? value
          : [value];
    const countError = validateInputFileCount(slot, files.length);
    if (countError) reject(countError);
    for (const value of files) {
      if (
        !isObjectRecord(value) ||
        value.transfer_method !== 'local_file' ||
        typeof value.upload_file_id !== 'string' ||
        !slot.methods.includes('local_file')
      )
        reject('INPUT_FILE_REFERENCE_INVALID');
      const id = value.upload_file_id as string;
      const identity = `${slot.target}\0${slot.key}\0${id}`;
      if (seen.has(identity)) reject('INPUT_FILE_DUPLICATE');
      seen.add(identity);
      const metadata = await loadDifyUploadMetadata({
        userId: context.actor.userId,
        serviceInstanceId: target.serviceInstanceId!,
        fileId: id,
      });
      if (!metadata) reject('INPUT_FILE_REATTACH_REQUIRED');
      const fileError = validateInputFile(slot, metadata);
      if (fileError) reject(fileError);
      const type = inputFileType(metadata.name, metadata.type);
      if (value.type !== type) reject('INPUT_FILE_TYPE');
    }
  };
  for (const slot of capabilities.attachmentSlots) {
    await checkSlot(
      slot,
      slot.target === 'files' ? body.files : inputs[slot.key]
    );
  }
  if (
    !capabilities.attachmentSlots.some(slot => slot.target === 'files') &&
    body.files !== undefined &&
    (!Array.isArray(body.files) || body.files.length > 0)
  )
    reject('INPUT_UPLOAD_DISABLED');
  const declared = new Set(
    capabilities.attachmentSlots
      .filter(slot => slot.target === 'inputs')
      .map(slot => slot.key)
  );
  const containsFile = (value: unknown, depth = 0): boolean => {
    if (depth > 12) return true;
    if (!value || typeof value !== 'object') return false;
    if (
      isObjectRecord(value) &&
      ('upload_file_id' in value || 'transfer_method' in value)
    )
      return true;
    return Object.values(value).some(child => containsFile(child, depth + 1));
  };
  for (const [key, value] of Object.entries(inputs))
    if (!declared.has(key) && containsFile(value))
      reject('INPUT_FILE_SLOT_INVALID');
}
