import { randomUUID } from 'node:crypto';

import { type AgentApp, AgentAppError } from './agent-app';
import { AgentPolicyError } from './agent-backends';
import {
  requireReadyAgentInput,
  resolveSharedAgentInputCapabilities,
  validateAgentInputFile,
} from './agent-input';
import {
  agentInputFileScope,
  loadAgentInputFiles,
  publicInputFile,
  registerAgentInputFile,
} from './agent-input-file-repository';
import { DifyRuntimeError, uploadDifyChatbotFile } from './agui/dify-transport';
import {
  assertDifyUploadStorage,
  readDifyUpload,
  saveDifyUpload,
} from './dify-upload-archive';
import {
  readLangChainInputFile,
  uploadLangChainInputFile,
} from './langchain/input-files';

export async function uploadAgentInputFile(
  app: AgentApp,
  userId: string,
  slotKey: string,
  file: File
) {
  if (app.backendType === 'dify' && app.interactionProtocol !== 'ag-ui/1.0')
    throw new AgentPolicyError(409, 'AGENT_INTERACTION_NOT_ENABLED');
  const capabilities = await resolveSharedAgentInputCapabilities(app);
  requireReadyAgentInput(capabilities);
  const slot = capabilities.attachmentSlots.find(slot => slot.key === slotKey);
  if (!slot) throw new AgentPolicyError(400, 'INPUT_FILE_SLOT_INVALID');
  if (!file.name || file.name.length > 255 || /[\x00-\x1f\x7f]/.test(file.name))
    throw new AgentPolicyError(400, 'INPUT_UPLOAD_INVALID');
  validateAgentInputFile(slot, file);
  const id = randomUUID();
  let metadata = { name: file.name, size: file.size, type: file.type };
  let nativeId: string;
  if (app.backendType === 'dify') {
    try {
      assertDifyUploadStorage();
    } catch {
      throw new AgentPolicyError(503, 'DIFY_UPLOAD_STORAGE_UNAVAILABLE');
    }
    try {
      nativeId = await uploadDifyChatbotFile(app, userId, file);
    } catch (error) {
      if (
        error instanceof DifyRuntimeError &&
        [400, 413, 415, 422].includes(error.status ?? 0)
      )
        throw new AgentPolicyError(400, 'INPUT_FILE_NOT_ALLOWED');
      throw new AgentPolicyError(502, 'DIFY_UPLOAD_FAILED');
    }
    try {
      await saveDifyUpload(
        { userId, serviceInstanceId: app.id, fileId: id },
        file
      );
    } catch {
      throw new AgentPolicyError(503, 'DIFY_UPLOAD_STORAGE_UNAVAILABLE');
    }
  } else {
    const { id: remoteId, ...uploaded } = await uploadLangChainInputFile(
      app,
      userId,
      slotKey,
      file
    );
    nativeId = remoteId;
    metadata = uploaded;
    validateAgentInputFile(slot, metadata);
  }
  const registered = { id, nativeId, slotKey, ...metadata };
  await registerAgentInputFile(agentInputFileScope(app, userId), registered);
  return publicInputFile(registered);
}

export async function readAgentInputFile(
  app: AgentApp,
  userId: string,
  fileId: string
) {
  const scope = agentInputFileScope(app, userId);
  const [file] = await loadAgentInputFiles(scope, [fileId]);
  if (!file) throw new AgentPolicyError(404, 'INPUT_FILE_NOT_FOUND');
  let content: Buffer;
  if (app.backendType === 'dify') {
    const archived = await readDifyUpload({
      userId,
      serviceInstanceId: app.id,
      fileId,
    }).catch(() => {
      throw new AgentPolicyError(503, 'DIFY_UPLOAD_STORAGE_UNAVAILABLE');
    });
    if (!archived) throw new AgentPolicyError(410, 'INPUT_FILE_UNAVAILABLE');
    content = archived.content;
  } else {
    const response = await readLangChainInputFile(
      app,
      userId,
      file.nativeId
    ).catch(error => {
      if (error instanceof AgentAppError && error.statusCode === 404)
        throw new AgentPolicyError(410, 'INPUT_FILE_UNAVAILABLE');
      throw error;
    });
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => undefined);
      if ([404, 410].includes(response.status))
        throw new AgentPolicyError(410, 'INPUT_FILE_UNAVAILABLE');
      throw new AgentPolicyError(502, 'INPUT_FILE_READ_FAILED');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > file.size)
          throw new AgentPolicyError(502, 'INPUT_FILE_READ_FAILED');
        chunks.push(result.value);
      }
      content = Buffer.concat(chunks, size);
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  if (content.length !== file.size)
    throw new AgentPolicyError(502, 'INPUT_FILE_READ_FAILED');
  if (!(await loadAgentInputFiles(scope, [fileId]))[0])
    throw new AgentPolicyError(404, 'INPUT_FILE_NOT_FOUND');
  return { content, file: publicInputFile(file) };
}
