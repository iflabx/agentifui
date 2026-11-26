import { create } from 'zustand';

import {
  type AgentAttachmentSlot,
  validateInputFile,
} from '../../packages/shared/src/agent-input';
import {
  parseDraftScope,
  readComposerDraft,
  scopedComposerDraftKey,
  writeComposerDraft,
} from './chat-draft-session';
import { useChatInputStore } from './chat-input-store';

export interface AttachmentFile {
  id: string;
  file?: File;
  name: string;
  size: number;
  type: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
  uploadedId?: string;
  uploadedPreviewUrl?: string;
  uploadedAppId?: string;
  uploadedActorId?: string;
  uploadedActorEpoch?: number;
  uploadAttempt?: number;
}

interface AttachmentStoreState {
  files: AttachmentFile[];
  currentScope: string;
  filesByScope: Record<string, AttachmentFile[]>;
  aliases: Record<string, string>;
  resolveScope: (scope: string) => string;
  setScope: (scope: string) => void;
  resetAll: () => void;
  migrateScope: (source: string, target: string) => boolean;
  getFiles: (scope: string) => AttachmentFile[];
  restoreFiles: (scope: string) => void;
  addFiles: (files: File[], scope?: string) => void;
  reserveFiles: (
    files: File[],
    slot: AgentAttachmentSlot,
    scope: string
  ) => { ids: string[]; error: string | null };
  removeFile: (id: string, scope?: string) => void;
  updateFileStatus: (
    id: string,
    status: AttachmentFile['status'],
    error?: string
  ) => void;
  updateFileUploadedId: (id: string, uploadedId: string) => void;
  clearFiles: () => void;
  setFiles: (files: AttachmentFile[], scope?: string) => void;
  beginUpload: (scope: string, id: string) => number | undefined;
  finishUpload: (
    scope: string,
    id: string,
    attempt: number,
    result:
      | {
          uploadedId: string;
          previewUrl?: string;
          appId?: string;
          actorId?: string;
          actorEpoch?: number;
        }
      | { error: string }
  ) => void;
  consumeFiles: (scope: string, files: AttachmentFile[]) => void;
}

function fileDraftStorage(scope: string) {
  const context = useChatInputStore.getState();
  const [kind, owner, third, fourth, parent, target, slot] =
    parseDraftScope(scope);
  if (
    kind === 'agent-input' &&
    typeof owner === 'string' &&
    typeof third === 'string' &&
    typeof fourth === 'string'
  ) {
    return {
      context,
      appId: parseDraftScope(owner)[2],
      key: scopedComposerDraftKey('agent-files', owner, context, third, fourth),
    };
  }
  if (
    kind === 'chatflow-attachments' &&
    owner === context.actorId &&
    third === context.actorEpoch &&
    typeof fourth === 'string' &&
    fourth === parseDraftScope(typeof parent === 'string' ? parent : '')[2] &&
    typeof parent === 'string' &&
    typeof target === 'string' &&
    typeof slot === 'string'
  ) {
    return {
      context,
      appId: fourth,
      key: scopedComposerDraftKey(
        'chatflow-files',
        parent,
        context,
        target,
        slot
      ),
    };
  }
  return {
    context,
    appId: third,
    key: scopedComposerDraftKey('chat-files', scope, context),
  };
}

function persistFiles(scope: string, files: AttachmentFile[]) {
  const { key, context, appId } = fileDraftStorage(scope);
  if (!key) return;
  const completed = files.flatMap(file =>
    file.status === 'success' &&
    file.uploadedId &&
    file.uploadedAppId === appId &&
    file.uploadedActorId === context.actorId &&
    file.uploadedActorEpoch === context.actorEpoch
      ? [
          {
            id: file.id,
            name: file.name,
            size: file.size,
            type: file.type,
            uploadedId: file.uploadedId,
          },
        ]
      : []
  );
  writeComposerDraft(key, completed.length ? completed : undefined);
}

function restoreFiles(scope: string): AttachmentFile[] {
  const { key, context, appId } = fileDraftStorage(scope);
  const stored = readComposerDraft(key);
  if (!Array.isArray(stored) || !context.actorId || typeof appId !== 'string')
    return [];
  return stored.flatMap((item: Partial<AttachmentFile> | null) =>
    item &&
    typeof item.id === 'string' &&
    typeof item.uploadedId === 'string' &&
    item.uploadedId &&
    typeof item.name === 'string' &&
    typeof item.size === 'number' &&
    Number.isFinite(item.size) &&
    item.size >= 0 &&
    typeof item.type === 'string'
      ? [
          {
            id: item.id,
            name: item.name,
            size: item.size,
            type: item.type,
            status: 'success' as const,
            uploadedId: item.uploadedId,
            uploadedAppId: appId,
            uploadedActorId: context.actorId!,
            uploadedActorEpoch: context.actorEpoch,
          },
        ]
      : []
  );
}

export const useAttachmentStore = create<AttachmentStoreState>((set, get) => ({
  files: [],
  currentScope: 'default',
  filesByScope: {},
  aliases: {},
  resolveScope: scope => {
    let resolved = scope;
    while (get().aliases[resolved]) resolved = get().aliases[resolved];
    return resolved;
  },
  getFiles: scope => {
    const resolved = get().resolveScope(scope);
    return resolved === get().currentScope
      ? get().files
      : get().filesByScope[resolved] || [];
  },
  restoreFiles: scope => {
    const resolved = get().resolveScope(scope);
    if (Object.hasOwn(get().filesByScope, resolved)) return;
    const files = restoreFiles(resolved);
    if (!files.length) return;
    set(state => ({
      filesByScope: { ...state.filesByScope, [resolved]: files },
      ...(resolved === state.currentScope ? { files } : {}),
    }));
  },
  setScope: scope => {
    const resolved = get().resolveScope(scope);
    get().restoreFiles(resolved);
    if (resolved === get().currentScope) return;
    set(state => ({
      filesByScope: {
        ...state.filesByScope,
        [state.currentScope]: state.files,
      },
      files: state.filesByScope[resolved] || [],
      currentScope: resolved,
    }));
  },
  resetAll: () =>
    set({ files: [], filesByScope: {}, aliases: {}, currentScope: 'default' }),
  setFiles: (files, scope = get().currentScope) => {
    const resolved = get().resolveScope(scope);
    persistFiles(resolved, files);
    set(state => ({
      filesByScope: { ...state.filesByScope, [resolved]: files },
      ...(resolved === state.currentScope ? { files } : {}),
    }));
  },
  addFiles: (files, scope = get().currentScope) => {
    const current = get().getFiles(scope);
    const additions = files
      .filter(file => !current.some(item => item.file === file))
      .map(file => ({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'pending' as const,
      }));
    get().setFiles([...current, ...additions], scope);
  },
  reserveFiles: (files, slot, scope) => {
    const resolved = get().resolveScope(scope);
    let result: { ids: string[]; error: string | null } = {
      ids: [],
      error: null,
    };
    set(state => {
      const current =
        resolved === state.currentScope
          ? state.files
          : state.filesByScope[resolved] || [];
      const additions = [...new Set(files)].filter(
        file => !current.some(entry => entry.file === file)
      );
      const error =
        current.length + additions.length > slot.maxCount
          ? 'INPUT_TOO_MANY_FILES'
          : (additions
              .map(file => validateInputFile(slot, file))
              .find(Boolean) ?? null);
      if (error) {
        result = { ids: [], error };
        return state;
      }
      const entries = additions.map(file => ({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'pending' as const,
      }));
      const next = [...current, ...entries];
      result = { ids: entries.map(entry => entry.id), error: null };
      return {
        filesByScope: { ...state.filesByScope, [resolved]: next },
        ...(resolved === state.currentScope ? { files: next } : {}),
      };
    });
    return result;
  },
  removeFile: (id, scope = get().currentScope) =>
    get().setFiles(
      get()
        .getFiles(scope)
        .filter(file => file.id !== id),
      scope
    ),
  updateFileStatus: (id, status, error) =>
    get().setFiles(
      get().files.map(file =>
        file.id === id
          ? {
              ...file,
              status,
              error,
              uploadedId: status === 'success' ? file.uploadedId : undefined,
            }
          : file
      )
    ),
  updateFileUploadedId: (id, uploadedId) =>
    get().setFiles(
      get().files.map(file =>
        file.id === id ? { ...file, uploadedId, status: 'success' } : file
      )
    ),
  clearFiles: () => get().setFiles([]),
  beginUpload: (scope, id) => {
    const files = get().getFiles(scope);
    const entry = files.find(file => file.id === id);
    if (!entry) return;
    const attempt = (entry.uploadAttempt || 0) + 1;
    get().setFiles(
      files.map(file =>
        file.id === id
          ? {
              ...file,
              uploadAttempt: attempt,
              status: 'uploading',
              uploadedId: undefined,
              uploadedAppId: undefined,
              error: undefined,
            }
          : file
      ),
      scope
    );
    return attempt;
  },
  finishUpload: (scope, id, attempt, result) => {
    const files = get().getFiles(scope);
    if (!files.some(file => file.id === id && file.uploadAttempt === attempt))
      return;
    get().setFiles(
      files.map(file =>
        file.id === id && file.uploadAttempt === attempt
          ? {
              ...file,
              ...('uploadedId' in result
                ? {
                    uploadedId: result.uploadedId,
                    uploadedPreviewUrl: result.previewUrl,
                    uploadedAppId: result.appId,
                    uploadedActorId: result.actorId,
                    uploadedActorEpoch: result.actorEpoch,
                    status: 'success' as const,
                    error: undefined,
                  }
                : {
                    error: result.error,
                    status: 'error' as const,
                    uploadedId: undefined,
                    uploadedPreviewUrl: undefined,
                    uploadedAppId: undefined,
                    uploadedActorId: undefined,
                    uploadedActorEpoch: undefined,
                  }),
            }
          : file
      ),
      scope
    );
  },
  consumeFiles: (scope, submitted) =>
    get().setFiles(
      get()
        .getFiles(scope)
        .filter(
          file =>
            !submitted.some(
              sent =>
                sent.id === file.id && sent.uploadAttempt === file.uploadAttempt
            )
        ),
      scope
    ),
  migrateScope: (source, target) => {
    source = get().resolveScope(source);
    target = get().resolveScope(target);
    if (source === target) return true;
    get().restoreFiles(target);
    if (get().getFiles(target).length) return false;
    const files = get().getFiles(source);
    const currentScope = get().currentScope;
    const filesByScope = { ...get().filesByScope, [target]: files };
    delete filesByScope[source];
    persistFiles(target, files);
    persistFiles(source, []);
    set({
      filesByScope,
      aliases: { ...get().aliases, [source]: target },
      ...(currentScope === source ? { currentScope: target, files } : {}),
      ...(currentScope === target ? { files } : {}),
    });
    return true;
  },
}));
