import { create } from 'zustand';

export interface AttachmentFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
  uploadedId?: string;
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
    result: { uploadedId: string } | { error: string }
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
                    status: 'success' as const,
                    error: undefined,
                  }
                : {
                    error: result.error,
                    status: 'error' as const,
                    uploadedId: undefined,
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
