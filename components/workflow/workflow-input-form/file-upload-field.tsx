'use client';

import { AttachmentPreviewItem } from '@components/chat-input/attachment-preview-item';
import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { cn } from '@lib/utils';
import { AlertCircle } from 'lucide-react';

import {
  type ChangeEvent,
  type DragEvent,
  type Ref,
  type SetStateAction,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useTranslations } from 'next-intl';

import {
  type AgentAttachmentSlot,
  validateInputFile,
} from '../../../packages/shared/src/agent-input';
import {
  type FileUploadFieldConfig,
  type UploadFile,
  type WorkflowUploadOwner,
  createUploadFiles,
  getFileSizeHint,
  getFileTypeInfo,
  getMaxFiles,
  getSuccessfulFilesPayload,
  isProcessedFileItem,
  restoreUploadFiles,
} from './file-upload-field/helpers';
import { FileUploadDropzone } from './file-upload-field/upload-dropzone';
import { UploadFileItem } from './file-upload-field/upload-file-item';

interface FileUploadFieldProps {
  config: FileUploadFieldConfig;
  value: unknown[] | unknown | null | undefined;
  onChange: (files: unknown[] | unknown | null) => void;
  error?: string;
  label?: string;
  instanceId: string;
  isSingleFileMode?: boolean;
  slot?: AgentAttachmentSlot;
  required?: boolean;
  onBlockedChange?: (blocked: boolean) => void;
  onRequirementsChanged?: () => void;
  restoreScope?: WorkflowUploadOwner;
  compact?: boolean;
  showCompactLabel?: boolean;
  inputId?: string;
  disabled?: boolean;
  onCountChange?: (count: number) => void;
  selectionRef?: Ref<FileUploadSelection>;
}

export interface FileUploadSelection {
  selectFiles: (files: File[]) => void;
}

export function FileUploadField(props: FileUploadFieldProps) {
  const { session, loading } = useAuthSession();
  const actorEpoch = useChatInputStore(state => state.actorEpoch);
  const userId = session?.user?.id;
  return (
    <ScopedFileUploadField
      key={JSON.stringify([props.instanceId, userId, actorEpoch])}
      {...props}
      userId={userId}
      actorEpoch={actorEpoch}
      loading={loading}
    />
  );
}

function ScopedFileUploadField({
  value,
  onChange,
  error,
  label,
  instanceId,
  isSingleFileMode = false,
  slot,
  required,
  onBlockedChange,
  onRequirementsChanged,
  restoreScope,
  userId,
  actorEpoch,
  loading,
  compact = false,
  showCompactLabel = false,
  inputId,
  disabled = false,
  onCountChange,
  selectionRef,
}: FileUploadFieldProps & {
  userId: string | undefined;
  actorEpoch: number;
  loading: boolean;
}) {
  const t = useTranslations('pages.workflow.fileUpload');
  const tChat = useTranslations('pages.chat');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFiles, setUploadFilesState] = useState<UploadFile[]>([]);
  const uploadFilesRef = useRef<UploadFile[]>([]);
  const setUploadFiles = useCallback((update: SetStateAction<UploadFile[]>) => {
    const next =
      typeof update === 'function' ? update(uploadFilesRef.current) : update;
    uploadFilesRef.current = next;
    setUploadFilesState(next);
  }, []);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const lastEmittedValue = useRef<unknown>(Symbol());
  const lastSuccessIdsRef = useRef('');
  const attempts = useRef(new Map<string, symbol | null>());
  const activeViewRef = useRef(false);
  const owner = useMemo<WorkflowUploadOwner | null>(
    () =>
      userId && instanceId
        ? { app_id: instanceId, actor_id: userId, actor_epoch: actorEpoch }
        : null,
    [instanceId, userId, actorEpoch]
  );
  useLayoutEffect(() => {
    activeViewRef.current = true;
    const viewAttempts = attempts.current;
    const unsubscribe = useChatInputStore.subscribe(next => {
      if (next.actorEpoch !== actorEpoch || next.actorId !== userId)
        activeViewRef.current = false;
    });
    return () => {
      activeViewRef.current = false;
      unsubscribe();
      viewAttempts.clear();
    };
  }, [actorEpoch, userId]);

  useLayoutEffect(() => {
    if (!activeViewRef.current || !owner) return;
    const actor = useChatInputStore.getState();
    if (
      actor.actorId !== owner.actor_id ||
      actor.actorEpoch !== owner.actor_epoch
    )
      return;
    if (value === lastEmittedValue.current) return;
    if (!value || (Array.isArray(value) && value.length === 0)) {
      attempts.current.clear();
      setSelectionError(null);
      setUploadFiles([]);
      return;
    }

    const valueArray = Array.isArray(value) ? value : [value];
    if (valueArray.length === 0) {
      return;
    }

    const isProcessedFiles = valueArray.every(item =>
      isProcessedFileItem(item)
    );
    if (isProcessedFiles) {
      const restored = restoreUploadFiles(valueArray, owner, restoreScope);
      const current = uploadFilesRef.current;
      const sameReferences =
        restored.length ===
          current.filter(file => file.status === 'success').length &&
        restored.every(file =>
          current.some(
            existing =>
              existing.status === 'success' &&
              existing.uploadedId === file.uploadedId
          )
        );
      if (sameReferences) return;
      attempts.current.clear();
      lastSuccessIdsRef.current = getSuccessfulFilesPayload(
        restored,
        isSingleFileMode,
        owner
      ).successIds;
      setSelectionError(null);
      setUploadFiles(restored);
      return;
    }

    const convertedFiles = createUploadFiles(
      valueArray.filter((file): file is File => file instanceof File)
    );
    if (convertedFiles.length > 0) {
      attempts.current.clear();
      convertedFiles.forEach(file => attempts.current.set(file.id, null));
      setUploadFiles(convertedFiles);
    }
  }, [value, setUploadFiles, owner, restoreScope, isSingleFileMode]);

  useLayoutEffect(() => {
    if (!activeViewRef.current || !owner || loading) return;
    const payload = getSuccessfulFilesPayload(
      uploadFilesRef.current,
      isSingleFileMode,
      owner
    );
    if (lastSuccessIdsRef.current !== payload.successIds) {
      lastSuccessIdsRef.current = payload.successIds;
      lastEmittedValue.current = payload.value;
      onChange(payload.value);
    }
  }, [uploadFiles, isSingleFileMode, onChange, owner, loading]);

  const updateFileStatus = useCallback(
    (
      id: string,
      status: UploadFile['status'],
      progress?: number,
      nextError?: string,
      uploadedId?: string,
      uploadOwner?: WorkflowUploadOwner,
      previewUrl?: string
    ) => {
      setUploadFiles(prev =>
        prev.map(file =>
          file.id === id
            ? {
                ...file,
                status,
                progress: progress ?? file.progress,
                error: status === 'error' ? nextError : undefined,
                uploadedId: status === 'success' ? uploadedId : file.uploadedId,
                previewUrl: status === 'success' ? previewUrl : file.previewUrl,
                ...uploadOwner,
              }
            : file
        )
      );
    },
    [setUploadFiles]
  );

  const uploadFileToDify = useCallback(
    async (uploadFile: UploadFile) => {
      const input = useChatInputStore.getState();
      if (
        disabled ||
        !activeViewRef.current ||
        loading ||
        !userId ||
        !instanceId ||
        !attempts.current.has(uploadFile.id) ||
        attempts.current.get(uploadFile.id) !== null ||
        input.actorId !== userId ||
        input.actorEpoch !== actorEpoch
      )
        return;
      if (
        !uploadFile.file ||
        !slot ||
        validateInputFile(slot, uploadFile.file) ||
        uploadFilesRef.current.length > slot.maxCount
      )
        return;
      const uploadOwner = {
        app_id: instanceId,
        actor_id: userId,
        actor_epoch: actorEpoch,
      };
      const attempt = Symbol(uploadFile.id);
      attempts.current.set(uploadFile.id, attempt);
      const isCurrent = () =>
        activeViewRef.current &&
        attempts.current.get(uploadFile.id) === attempt &&
        useChatInputStore.getState().actorId === uploadOwner.actor_id &&
        useChatInputStore.getState().actorEpoch === uploadOwner.actor_epoch;

      try {
        updateFileStatus(
          uploadFile.id,
          'uploading',
          0,
          undefined,
          undefined,
          uploadOwner
        );
        const response = await uploadDifyFile(
          uploadOwner.app_id,
          uploadFile.file,
          uploadOwner.actor_id
        );

        if (!isCurrent()) return;
        updateFileStatus(
          uploadFile.id,
          'success',
          undefined,
          undefined,
          response.id,
          uploadOwner,
          response.preview_url || response.source_url || undefined
        );
      } catch (uploadError) {
        if (!isCurrent()) return;
        const errorMessage =
          (uploadError as Error).message || t('uploadFailed');
        updateFileStatus(uploadFile.id, 'error', undefined, errorMessage);
        onRequirementsChanged?.();
        console.error(
          `[Workflow file upload] Upload failed: ${uploadFile.name}`,
          uploadError
        );
      }
    },
    [
      instanceId,
      userId,
      actorEpoch,
      loading,
      t,
      updateFileStatus,
      slot,
      onRequirementsChanged,
      disabled,
    ]
  );

  useEffect(() => {
    if (loading) return;
    uploadFiles.forEach(uploadFile => {
      if (uploadFile.status === 'pending') void uploadFileToDify(uploadFile);
    });
  }, [loading, uploadFiles, uploadFileToDify]);

  const handleFileSelect = useCallback(
    (newFiles: File[]) => {
      const input = useChatInputStore.getState();
      if (
        disabled ||
        !activeViewRef.current ||
        !owner ||
        input.actorId !== owner.actor_id ||
        input.actorEpoch !== owner.actor_epoch
      )
        return;
      if (!slot) {
        setSelectionError('INPUT_CAPABILITIES_UNAVAILABLE');
        return;
      }
      const additions = [...new Set(newFiles)].filter(
        file => !uploadFilesRef.current.some(entry => entry.file === file)
      );
      const nextError =
        uploadFilesRef.current.length + additions.length >
        getMaxFiles(slot, isSingleFileMode)
          ? 'INPUT_TOO_MANY_FILES'
          : (additions
              .map(file => validateInputFile(slot, file))
              .find(Boolean) ?? null);
      if (nextError) {
        setSelectionError(nextError);
        return;
      }
      setSelectionError(null);
      const newUploadFiles = createUploadFiles(additions);
      newUploadFiles.forEach(uploadFile => {
        attempts.current.set(uploadFile.id, null);
      });
      setUploadFiles(prev => [...prev, ...newUploadFiles]);
    },
    [owner, slot, isSingleFileMode, setUploadFiles, disabled]
  );

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      handleFileSelect(files);
      event.target.value = '';
    }
  };

  useImperativeHandle(selectionRef, () => ({ selectFiles: handleFileSelect }), [
    handleFileSelect,
  ]);

  const handleRemoveFile = (id: string) => {
    if (disabled || !activeViewRef.current) return;
    attempts.current.delete(id);
    setUploadFiles(prev => prev.filter(file => file.id !== id));
    setSelectionError(null);
  };

  const handleRetryUpload = useCallback(
    (id: string) => {
      if (disabled) return;
      const uploadFile = uploadFiles.find(file => file.id === id);
      if (uploadFile?.file && uploadFile.status === 'error') {
        const nextError = !slot
          ? 'INPUT_CAPABILITIES_UNAVAILABLE'
          : validateInputFile(slot, uploadFile.file);
        if (
          nextError ||
          (slot && uploadFilesRef.current.length > slot.maxCount)
        ) {
          setSelectionError(nextError || 'INPUT_TOO_MANY_FILES');
          return;
        }
        setSelectionError(null);
        attempts.current.set(id, null);
        setUploadFiles(prev =>
          prev.map(file =>
            file.id === id
              ? { ...file, status: 'pending', error: undefined }
              : file
          )
        );
      }
    },
    [uploadFiles, slot, setUploadFiles, disabled]
  );

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files);
    }
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
  };

  const isUploading = uploadFiles.some(file => file.status === 'uploading');
  const successCount = uploadFiles.filter(
    file => file.status === 'success'
  ).length;
  const maxFiles = getMaxFiles(slot, isSingleFileMode);
  const canUploadMore = Boolean(
    slot?.methods.includes('local_file') && uploadFiles.length < maxFiles
  );
  const fileTypeInfo = getFileTypeInfo(slot, t);
  const fileSizeHint = getFileSizeHint(slot, t);
  const capabilityError = !slot
    ? uploadFiles.length
      ? 'INPUT_CAPABILITIES_UNAVAILABLE'
      : null
    : uploadFiles.length > maxFiles
      ? 'INPUT_TOO_MANY_FILES'
      : uploadFiles
          .map(file => validateInputFile(slot, file.file ?? file))
          .find(Boolean);
  const blocked =
    Boolean(capabilityError) ||
    uploadFiles.some(file => file.status !== 'success');
  useLayoutEffect(() => {
    onBlockedChange?.(blocked);
  }, [blocked, onBlockedChange]);
  useLayoutEffect(() => {
    onCountChange?.(uploadFiles.length);
  }, [uploadFiles.length, onCountChange]);
  const errorCode = error || selectionError || capabilityError;
  const displayedError =
    errorCode === 'INPUT_CAPABILITIES_UNAVAILABLE'
      ? tChat('input.capabilitiesUnavailable')
      : errorCode === 'INPUT_TOO_MANY_FILES'
        ? tChat('fileTypeSelector.maxFilesReached', { maxFiles })
        : errorCode === 'INPUT_FILE_SIZE'
          ? tChat('fileUpload.fileTooLarge')
          : errorCode === 'INPUT_FILE_TYPE'
            ? tChat('fileUpload.unsupportedFormat')
            : errorCode;

  if (compact)
    return (
      <div
        className={
          uploadFiles.length || displayedError ? 'px-3 pt-3 pb-2' : undefined
        }
      >
        <input
          id={inputId}
          ref={fileInputRef}
          type="file"
          className="hidden"
          aria-label={label}
          accept={fileTypeInfo.accept}
          multiple={!isSingleFileMode && maxFiles - uploadFiles.length > 1}
          disabled={disabled || !owner || !canUploadMore}
          onChange={handleFileInputChange}
        />
        {uploadFiles.length > 0 && (
          <div role="group" aria-label={label}>
            {showCompactLabel && label && (
              <p className="mb-1 text-xs text-stone-500 dark:text-stone-400">
                {label}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {uploadFiles.map(file => (
                <AttachmentPreviewItem
                  key={file.id}
                  attachment={file}
                  disabled={disabled}
                  onRemove={handleRemoveFile}
                  onRetry={handleRetryUpload}
                />
              ))}
            </div>
          </div>
        )}
        {displayedError && (
          <p
            role="alert"
            className="mt-2 text-sm text-amber-700 dark:text-amber-300"
          >
            {displayedError}
          </p>
        )}
      </div>
    );

  return (
    <div className="space-y-4">
      {(!slot ||
        !slot.methods.includes('local_file') ||
        slot.maxCount === 0) && (
        <p
          role="status"
          className="font-serif text-sm text-stone-600 dark:text-stone-400"
        >
          {tChat(
            !slot
              ? 'input.capabilitiesUnavailable'
              : 'fileTypeSelector.notSupported'
          )}
        </p>
      )}
      {uploadFiles.some(file => file.status !== 'success') && (
        <p
          role="status"
          className="font-serif text-sm text-amber-700 dark:text-amber-300"
        >
          {tChat('input.uploadPending')}
        </p>
      )}
      {label && (
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              'bg-gradient-to-r from-stone-500 to-stone-400'
            )}
          />
          <label
            className={cn(
              'font-serif text-sm font-semibold',
              'text-stone-800 dark:text-stone-200'
            )}
          >
            {label}
            {required && <span className="ml-1 text-red-500">*</span>}
            {successCount > 0 && (
              <span
                className={cn(
                  'ml-2 rounded-full px-2 py-1 text-xs',
                  'bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-400'
                )}
              >
                {successCount}/{maxFiles} {t('uploaded')}
              </span>
            )}
          </label>
        </div>
      )}

      <FileUploadDropzone
        accept={fileTypeInfo.accept}
        canUploadMore={canUploadMore}
        error={displayedError || undefined}
        fileInputRef={fileInputRef}
        fileSizeHint={fileSizeHint}
        fileTypeHint={fileTypeInfo.hint}
        inputDisabled={!owner || isUploading || !canUploadMore}
        isUploading={isUploading}
        maxFiles={maxFiles}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onInputChange={handleFileInputChange}
        remaining={Math.max(0, maxFiles - uploadFiles.length)}
        t={t}
      />

      {maxFiles > 0 && uploadFiles.length >= maxFiles && (
        <div
          className={cn(
            'flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg',
            'border-amber-200 bg-gradient-to-r from-amber-50 to-amber-100/50 shadow-amber-100/50 dark:border-amber-700/50 dark:bg-gradient-to-r dark:from-amber-900/20 dark:to-amber-800/20 dark:shadow-amber-900/20'
          )}
        >
          <div className="h-2 w-2 rounded-full bg-amber-500" />
          <p
            className={cn(
              'font-serif text-sm',
              'text-amber-700 dark:text-amber-300'
            )}
          >
            {t('maxFilesReached', {
              current: uploadFiles.length,
              max: maxFiles,
            })}
          </p>
        </div>
      )}

      {uploadFiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'h-px flex-1 bg-gradient-to-r from-transparent to-transparent',
                'via-stone-300 dark:via-stone-600'
              )}
            />
            <span
              className={cn(
                'rounded-full border px-3 py-1 font-serif text-xs',
                'border-stone-200 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400'
              )}
            >
              {t('selectedFiles')}
            </span>
            <div
              className={cn(
                'h-px flex-1 bg-gradient-to-r from-transparent to-transparent',
                'via-stone-300 dark:via-stone-600'
              )}
            />
          </div>

          <div className="grid gap-3">
            {uploadFiles.map(uploadFile => (
              <UploadFileItem
                key={uploadFile.id}
                onRemove={handleRemoveFile}
                onRetry={handleRetryUpload}
                t={t}
                uploadFile={uploadFile}
              />
            ))}
          </div>
        </div>
      )}

      {displayedError && (
        <div
          className={cn(
            'flex items-center gap-3 rounded-xl border p-4 shadow-lg',
            'border-red-200 bg-gradient-to-r from-red-50 to-red-100/50 shadow-red-100/50 dark:border-red-700/50 dark:bg-gradient-to-r dark:from-red-900/20 dark:to-red-800/20 dark:shadow-red-900/20'
          )}
        >
          <AlertCircle className="h-4 w-4 text-red-500" />
          <p
            className={cn(
              'font-serif text-sm',
              'text-red-700 dark:text-red-300'
            )}
          >
            {displayedError}
          </p>
        </div>
      )}
    </div>
  );
}
