import { create } from 'zustand';

import {
  type AgentAttachmentSlot,
  validateInputFile,
} from '../../packages/shared/src/agent-input';

export interface AttachmentFile {
  id: string;
  file: File;
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
  setScope: scope => {
    const resolved = get().resolveScope(scope);
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
    if (get().getFiles(target).length) return false;
    const files = get().getFiles(source);
    const currentScope = get().currentScope;
    const filesByScope = { ...get().filesByScope, [target]: files };
    delete filesByScope[source];
    set({
      filesByScope,
      aliases: { ...get().aliases, [source]: target },
      ...(currentScope === source ? { currentScope: target, files } : {}),
      ...(currentScope === target ? { files } : {}),
    });
    return true;
  },
}));
