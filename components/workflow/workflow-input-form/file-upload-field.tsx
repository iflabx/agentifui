'use client';

import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import { uploadDifyFile } from '@lib/services/dify/file-service';
import { cn } from '@lib/utils';
import { AlertCircle } from 'lucide-react';

import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useTranslations } from 'next-intl';

import {
  type FileUploadFieldConfig,
  type UploadFile,
  createUploadFiles,
  getDifyFileType,
  getFileSizeHint,
  getFileTypeInfo,
  getMaxFiles,
  getSuccessfulFilesPayload,
  isProcessedFileItem,
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
}

export function FileUploadField({
  config,
  value,
  onChange,
  error,
  label,
  instanceId,
  isSingleFileMode = false,
}: FileUploadFieldProps) {
  const { session } = useAuthSession();
  const { currentAppId } = useCurrentApp();
  const t = useTranslations('pages.workflow.fileUpload');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const lastSuccessIdsRef = useRef('');

  useEffect(() => {
    if (!value || (Array.isArray(value) && value.length === 0)) {
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
      return;
    }

    const convertedFiles = createUploadFiles(
      valueArray.filter((file): file is File => file instanceof File)
    );
    if (convertedFiles.length > 0) {
      setUploadFiles(convertedFiles);
    }
  }, [value]);

  useLayoutEffect(() => {
    const payload = getSuccessfulFilesPayload(uploadFiles, isSingleFileMode);
    if (lastSuccessIdsRef.current !== payload.successIds) {
      lastSuccessIdsRef.current = payload.successIds;
      onChange(payload.value);
    }
  }, [uploadFiles, isSingleFileMode, onChange]);

  const updateFileStatus = useCallback(
    (
      id: string,
      status: UploadFile['status'],
      progress?: number,
      nextError?: string,
      uploadedId?: string
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
              }
            : file
        )
      );
    },
    []
  );

  const uploadFileToDify = useCallback(
    async (uploadFile: UploadFile) => {
      const userIdToUse = session?.user?.id || 'workflow-user-id';

      try {
        updateFileStatus(uploadFile.id, 'uploading', 0);
        const appIdToUse = currentAppId || instanceId;
        const response = await uploadDifyFile(
          appIdToUse,
          uploadFile.file,
          userIdToUse
        );

        updateFileStatus(
          uploadFile.id,
          'success',
          undefined,
          undefined,
          response.id
        );
      } catch (uploadError) {
        const errorMessage =
          (uploadError as Error).message || t('uploadFailed');
        updateFileStatus(uploadFile.id, 'error', undefined, errorMessage);
        console.error(
          `[Workflow file upload] Upload failed: ${uploadFile.name}`,
          uploadError
        );
      }
    },
    [currentAppId, instanceId, session?.user?.id, t, updateFileStatus]
  );

  const handleFileSelect = useCallback(
    (newFiles: File[]) => {
      const newUploadFiles = createUploadFiles(newFiles);
      newUploadFiles.forEach(uploadFile => {
        setTimeout(() => {
          void uploadFileToDify(uploadFile);
        }, 100);
      });
      setUploadFiles(prev => [...prev, ...newUploadFiles]);
    },
    [uploadFileToDify]
  );

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      handleFileSelect(files);
      event.target.value = '';
    }
  };

  const handleRemoveFile = (id: string) => {
    setUploadFiles(prev => prev.filter(file => file.id !== id));
  };

  const handleRetryUpload = useCallback(
    (id: string) => {
      const uploadFile = uploadFiles.find(file => file.id === id);
      if (uploadFile && uploadFile.status === 'error') {
        void uploadFileToDify(uploadFile);
      }
    },
    [uploadFiles, uploadFileToDify]
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

  if (config?.enabled === false) {
    return null;
  }

  const isUploading = uploadFiles.some(file => file.status === 'uploading');
  const successCount = uploadFiles.filter(
    file => file.status === 'success'
  ).length;
  const maxFiles = getMaxFiles(config, isSingleFileMode);
  const canUploadMore = uploadFiles.length < maxFiles;
  const fileTypeInfo = getFileTypeInfo(config, t);
  const fileSizeHint = getFileSizeHint(config, t);

  return (
    <div className="space-y-4">
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
        error={error}
        fileInputRef={fileInputRef}
        fileSizeHint={fileSizeHint}
        fileTypeHint={fileTypeInfo.hint}
        inputDisabled={isUploading || !canUploadMore}
        isUploading={isUploading}
        maxFiles={maxFiles}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onInputChange={handleFileInputChange}
        remaining={maxFiles - uploadFiles.length}
        t={t}
      />

      {uploadFiles.length >= maxFiles && (
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

      {error && (
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
            {error}
          </p>
        </div>
      )}
    </div>
  );
}
