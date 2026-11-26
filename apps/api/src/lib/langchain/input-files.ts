import {
  type AgentInputCapabilities,
  inputFileExtension,
  validateInputFile,
} from '@agentifui/shared';

import {
  type AgentApp,
  AgentAppError,
  langChainConfigForActor,
} from '../agent-app';
import {
  MAX_LANGCHAIN_INPUT_BYTES,
  isLangChainInputFileId,
  langChainInputCapabilities,
  langChainInputFileMime,
} from './input-profile';
import {
  LangChainUpstreamError,
  getCapabilities,
  getNativeInputFileContent,
  getNativeInputFileMetadata,
  supportsResultArtifacts,
  uploadNativeInputFile,
} from './transport';

interface LangChainInputFile {
  id: string;
  name: string;
  size: number;
  type: string;
}

function unsupportedInputCapabilities(): AgentInputCapabilities {
  return langChainInputCapabilities('unsupported', 'INPUT_PROFILE_UNSUPPORTED');
}

export async function resolveLangChainInputCapabilities(
  app: AgentApp
): Promise<AgentInputCapabilities> {
  if (app.backendType === 'dify') return unsupportedInputCapabilities();
  try {
    const capabilities = await getCapabilities(app);
    if (
      capabilities.assistantId !== app.assistantId ||
      (app.humanInput
        ? capabilities.inputCapabilities !== undefined
        : (app.resultProfileEnabled === false &&
            !capabilities.inputCapabilities) ||
          supportsResultArtifacts(capabilities) !==
            (app.resultProfileEnabled === true))
    ) {
      return unsupportedInputCapabilities();
    }
    return (
      capabilities.inputCapabilities ?? langChainInputCapabilities('ready')
    );
  } catch (error) {
    if (
      error instanceof LangChainUpstreamError &&
      error.code === 'INPUT_PROFILE_UNSUPPORTED'
    ) {
      return unsupportedInputCapabilities();
    }
    return langChainInputCapabilities(
      'unavailable',
      'INPUT_CAPABILITIES_UNAVAILABLE'
    );
  }
}

function isSafeName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const characters = [...value];
  return (
    characters.length > 0 &&
    characters.length <= 120 &&
    !value.includes('/') &&
    !value.includes('\\') &&
    characters.every(character => {
      const point = character.codePointAt(0)!;
      return point >= 32 && point !== 127 && (point < 0xd800 || point > 0xdfff);
    })
  );
}

function parseMetadata(
  data: Record<string, unknown>
): LangChainInputFile & { slotKey: string } {
  const { fileId, slotKey, name, sizeBytes, mimeType } = data;
  if (
    !isLangChainInputFileId(fileId) ||
    slotKey !== 'reference' ||
    !isSafeName(name) ||
    typeof sizeBytes !== 'number' ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 1 ||
    sizeBytes > MAX_LANGCHAIN_INPUT_BYTES ||
    typeof mimeType !== 'string' ||
    langChainInputFileMime(inputFileExtension(name)) !== mimeType
  ) {
    throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
  }
  return { id: fileId, slotKey, name, size: sizeBytes, type: mimeType };
}

function fileError(error: unknown): AgentAppError {
  if (error instanceof AgentAppError) return error;
  if (error instanceof LangChainUpstreamError) {
    if (error.status === 404)
      return new AgentAppError(404, 'INPUT_FILE_UNAVAILABLE');
    if (error.status === 413) return new AgentAppError(413, 'INPUT_FILE_SIZE');
    if (error.status === 415) return new AgentAppError(415, 'INPUT_FILE_TYPE');
    if (error.status === 422)
      return new AgentAppError(422, 'INPUT_FILE_INVALID');
    if (error.status === 429)
      return new AgentAppError(429, 'INPUT_FILE_QUOTA_EXCEEDED');
    if (error.status === 408 || error.code === 'UPSTREAM_TIMEOUT')
      return new AgentAppError(504, 'INPUT_FILE_TIMEOUT');
  }
  return new AgentAppError(503, 'INPUT_FILE_UPSTREAM_UNAVAILABLE');
}

export async function uploadLangChainInputFile(
  app: AgentApp,
  actorId: string,
  slotKey: string,
  file: File
): Promise<LangChainInputFile> {
  const capabilities = await resolveLangChainInputCapabilities(app);
  if (capabilities.status === 'unavailable') {
    throw new AgentAppError(503, 'INPUT_CAPABILITIES_UNAVAILABLE');
  }
  const slot = capabilities.attachmentSlots.find(
    candidate => candidate.key === slotKey
  );
  if (!slot) {
    throw new AgentAppError(
      capabilities.attachmentSlots.length ? 422 : 409,
      capabilities.attachmentSlots.length
        ? 'INPUT_SLOT_INVALID'
        : 'INPUT_UPLOAD_DISABLED'
    );
  }
  if (!isSafeName(file.name))
    throw new AgentAppError(422, 'INPUT_FILE_INVALID');
  const validation = validateInputFile(slot, file);
  if (validation || file.size === 0) {
    const code = validation ?? 'INPUT_FILE_SIZE';
    throw new AgentAppError(code === 'INPUT_FILE_TYPE' ? 415 : 413, code);
  }
  try {
    const uploaded = parseMetadata(
      await uploadNativeInputFile(
        langChainConfigForActor(app, actorId),
        slotKey,
        file
      )
    );
    if (
      uploaded.slotKey !== slotKey ||
      uploaded.size !== file.size ||
      validateInputFile(slot, uploaded)
    ) {
      throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
    }
    return {
      id: uploaded.id,
      name: uploaded.name,
      size: uploaded.size,
      type: uploaded.type,
    };
  } catch (error) {
    throw fileError(error);
  }
}

export async function readLangChainInputFileMetadata(
  app: AgentApp,
  actorId: string,
  fileId: string
): Promise<LangChainInputFile & { slotKey: string }> {
  const config = langChainConfigForActor(app, actorId);
  if (!config.scope || !isLangChainInputFileId(fileId)) {
    throw new AgentAppError(404, 'INPUT_FILE_UNAVAILABLE');
  }
  try {
    const metadata = parseMetadata(
      await getNativeInputFileMetadata(config, fileId)
    );
    if (metadata.id !== fileId)
      throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
    return metadata;
  } catch (error) {
    throw fileError(error);
  }
}

export async function readLangChainInputFile(
  app: AgentApp,
  actorId: string,
  fileId: string
): Promise<Response> {
  const metadata = await readLangChainInputFileMetadata(app, actorId, fileId);
  const config = langChainConfigForActor(app, actorId);
  try {
    const bytes = await getNativeInputFileContent(config, fileId, metadata);
    const filename = encodeURIComponent(metadata.name).replace(
      /['()*]/g,
      char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    );
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': metadata.type,
        'Content-Length': String(metadata.size),
        'Content-Disposition': `attachment; filename=attachment; filename*=UTF-8''${filename}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    throw fileError(error);
  }
}
