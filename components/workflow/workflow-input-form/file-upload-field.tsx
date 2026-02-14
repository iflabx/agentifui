'use client';

import { Spinner } from '@components/ui/spinner';
import { TooltipWrapper } from '@components/ui/tooltip-wrapper';
import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import { uploadDifyFile } from '@lib/services/dify/file-service';
import type { DifyFileUploadResponse } from '@lib/services/dify/types';
import { cn, formatBytes } from '@lib/utils';
import {
  AlertCircle,
  CheckCircle2Icon,
  File,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

// Define the interface for the upload file status, consistent with the chat input component
interface UploadFile {
  id: string; // Local generated unique ID
  file: File; // Original File object
  name: string; // File name
  size: number; // File size
  type: string; // File type (MIME type)
  status: 'pending' | 'uploading' | 'success' | 'error'; // Upload status
  progress: number; // Upload progress (0-100)
  error?: string; // Error message
  uploadedId?: string; // File ID returned by Dify after successful upload
}

interface FileUploadFieldProps {
  config: any;
  value: any[] | any; // Support single file object or file array
  onChange: (files: any[] | any) => void; // Return Dify-formatted file object or array
  error?: string;
  label?: string;
  instanceId: string; // Add instanceId for Dify API call
  isSingleFileMode?: boolean; // Whether to use single file mode
}

/**
 * Workflow file upload field component - integrate Dify file upload API
 *
 * Features:
 * - Integrate Dify file upload API
 * - Real-time upload progress display
 * - Support retry upload
 * - File status management
 * - File upload functionality consistent with chat input component
 */
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

  // Local file status management, used to track upload status
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);

  // When the external value prop changes, synchronize the uploadFiles status
  // Support form reset to clear file list
  useEffect(() => {
    // If value is empty (null, undefined, empty array), clear the file list
    if (!value || (Array.isArray(value) && value.length === 0)) {
      setUploadFiles([]);
      return;
    }

    // Handle the case of a single file object
    const valueArray = Array.isArray(value) ? value : [value];

    if (valueArray.length > 0) {
      // Check if value is already in Dify file format
      const isProcessedFiles = valueArray.every(
        (item: any) => typeof item === 'object' && item.upload_file_id
      );

      if (!isProcessedFiles) {
        // If it is an original File object array, convert to UploadFile format
        const convertedFiles = valueArray.map((file: File) => ({
          id: `${file.name}-${file.lastModified}-${file.size}`,
          file,
          name: file.name,
          size: file.size,
          type: file.type,
          status: 'pending' as const,
          progress: 0,
        }));
        setUploadFiles(convertedFiles);
      }
    }
  }, [value]);

  // Use ref to track the last successful file ID list, avoid infinite loop
  const lastSuccessIdsRef = useRef('');

  // When the uploadFiles status changes, notify the parent component
  // Determine whether to return a single file object or an array of files based on number_limits
  useEffect(() => {
    const successfulFiles = uploadFiles
      .filter(file => file.status === 'success' && file.uploadedId)
      .map(file => ({
        type: getDifyFileType(file),
        transfer_method: 'local_file' as const,
        upload_file_id: file.uploadedId as string,
        // --- Add extra fields for message display ---
        name: file.name,
        size: file.size,
        mime_type: file.type,
      }));

    // Only call onChange when the successful file list actually changes
    const currentSuccessIds = successfulFiles
      .map(f => f.upload_file_id)
      .sort()
      .join(',');

    if (lastSuccessIdsRef.current !== currentSuccessIds) {
      lastSuccessIdsRef.current = currentSuccessIds;

      // Determine whether to return a single file object or an array of files based on isSingleFileMode
      if (isSingleFileMode) {
        // Single file mode: return the first file object or null
        const singleFile =
          successfulFiles.length > 0 ? successfulFiles[0] : null;
        onChange(singleFile);
      } else {
        // Multiple file mode: return the file array
        onChange(successfulFiles);
      }
    }
  }, [uploadFiles, isSingleFileMode]); // Add isSingleFileMode dependency

  // Infer the Dify file type field based on the file type
  const getDifyFileType = (
    file: UploadFile
  ): 'image' | 'document' | 'audio' | 'video' | 'custom' => {
    const mime = file.type.toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (
      mime === 'application/pdf' ||
      mime.includes('word') ||
      mime.includes('excel') ||
      mime.includes('csv') ||
      mime.includes('text') ||
      mime.includes('html') ||
      mime.includes('xml') ||
      mime.includes('epub') ||
      mime.includes('powerpoint')
    )
      return 'document';
    return 'custom';
  };

  // Helper function to update file status
  const updateFileStatus = useCallback(
    (
      id: string,
      status: UploadFile['status'],
      progress?: number,
      error?: string,
      uploadedId?: string
    ) => {
      setUploadFiles(prev =>
        prev.map(file =>
          file.id === id
            ? {
                ...file,
                status,
                progress: progress ?? file.progress,
                error: status === 'error' ? error : undefined,
                uploadedId: status === 'success' ? uploadedId : file.uploadedId,
              }
            : file
        )
      );
    },
    []
  );

  // Upload a single file to Dify - use the current application ID, consistent with the chat input field
  const uploadFileToDify = useCallback(
    async (uploadFile: UploadFile) => {
      const userIdToUse = session?.user?.id || 'workflow-user-id';

      try {
        updateFileStatus(uploadFile.id, 'uploading', 0);

        // Use the current application ID, if not available, fallback to instanceId
        // Consistent with the logic of the chat input field
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
      } catch (error) {
        const errorMessage = (error as Error).message || t('uploadFailed');
        updateFileStatus(uploadFile.id, 'error', undefined, errorMessage);
        console.error(
          `[Workflow file upload] Upload failed: ${uploadFile.name}`,
          error
        );
      }
    },
    [currentAppId, instanceId, session?.user?.id, updateFileStatus]
  );

  // Handle file selection
  const handleFileSelect = useCallback(
    (newFiles: File[]) => {
      const newUploadFiles = newFiles.map(file => {
        const uploadFile: UploadFile = {
          id: `${file.name}-${file.lastModified}-${file.size}`,
          file,
          name: file.name,
          size: file.size,
          type: file.type,
          status: 'pending',
          progress: 0,
        };

        // Start uploading immediately
        setTimeout(() => uploadFileToDify(uploadFile), 100);

        return uploadFile;
      });

      setUploadFiles(prev => [...prev, ...newUploadFiles]);
    },
    [uploadFileToDify]
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      handleFileSelect(files);
      // Reset the input field
      e.target.value = '';
    }
  };

  const handleRemoveFile = (id: string) => {
    setUploadFiles(prev => prev.filter(file => file.id !== id));
  };

  // Retry upload
  const handleRetryUpload = useCallback(
    (id: string) => {
      const uploadFile = uploadFiles.find(file => file.id === id);
      if (uploadFile && uploadFile.status === 'error') {
        uploadFileToDify(uploadFile);
      }
    },
    [uploadFiles, uploadFileToDify]
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // File upload field is enabled by default, unless explicitly set to false
  if (config?.enabled === false) {
    return null;
  }

  // Calculate status statistics
  const isUploading = uploadFiles.some(f => f.status === 'uploading');
  const hasError = uploadFiles.some(f => f.status === 'error');
  const successCount = uploadFiles.filter(f => f.status === 'success').length;
  // Determine the maximum number of files based on isSingleFileMode and configuration
  // file-list type uses the max_length field, file type uses the number_limits field
  const maxFiles = isSingleFileMode
    ? 1
    : config.max_length || config.number_limits || 1;
  const canUploadMore = uploadFiles.length < maxFiles;

  // Generate file type hint and accept string based on Dify file type identifier
  // Reference the logic of file-type-selector.tsx
  const getFileTypeInfo = () => {
    const types = config.allowed_file_types;
    if (!types || types.length === 0) {
      return {
        hint: t('supportAllTypes'),
        accept: undefined,
      };
    }

    const typeMap: Record<string, { name: string; accept: string }> = {
      image: {
        name: t('fileTypes.image'),
        accept: 'image/*,.jpg,.jpeg,.png,.gif,.bmp,.svg,.webp,.ico,.tiff,.tif',
      },
      document: {
        name: t('fileTypes.document'),
        accept:
          '.txt,.md,.mdx,.markdown,.pdf,.html,.xlsx,.xls,.doc,.docx,.csv,.eml,.msg,.pptx,.ppt,.xml,.epub',
      },
      audio: {
        name: t('fileTypes.audio'),
        accept: 'audio/*,.mp3,.wav,.flac,.aac,.ogg,.wma,.m4a,.opus',
      },
      video: {
        name: t('fileTypes.video'),
        accept: 'video/*,.mp4,.avi,.mkv,.mov,.wmv,.flv,.webm,.m4v,.3gp',
      },
      custom: { name: t('fileTypes.custom'), accept: '*/*' },
    };

    const supportedTypes = types
      .map((type: string) => typeMap[type]?.name || type)
      .filter(Boolean);
    const acceptStrings = types
      .map((type: string) => typeMap[type]?.accept)
      .filter(Boolean);

    return {
      hint:
        supportedTypes.length > 0
          ? t('supportTypes', { types: supportedTypes.join('、') })
          : t('supportAllTypes'),
      accept: acceptStrings.length > 0 ? acceptStrings.join(',') : undefined,
    };
  };

  const fileTypeInfo = getFileTypeInfo();

  // Generate file size hint text
  const getFileSizeHint = () => {
    const maxSize = config.max_file_size_mb;
    if (maxSize) {
      return t('maxFileSize', { size: maxSize });
    }
    return '';
  };

  return (
    <div className="space-y-4">
      {/* Label */}
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

      {/* Upload area */}
      {canUploadMore && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className={cn(
            'group relative cursor-pointer rounded-xl border-2 border-dashed p-8 text-center',
            'backdrop-blur-sm transition-all duration-300 ease-in-out',
            'hover:scale-[1.01] hover:shadow-lg',
            'bg-gradient-to-br from-white/80 to-stone-50/80 dark:from-stone-800/80 dark:to-stone-700/80',
            error
              ? 'border-red-400 bg-red-50/50 hover:border-red-300 dark:bg-red-900/10'
              : 'border-stone-300 hover:border-stone-400 dark:border-stone-600 dark:hover:border-stone-500',
            isUploading && 'cursor-not-allowed opacity-75'
          )}
          onClick={() => !isUploading && fileInputRef.current?.click()}
        >
          {/* Background decoration */}
          <div
            className={cn(
              'absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100',
              'transition-opacity duration-300',
              'bg-gradient-to-br from-stone-100/50 to-stone-200/50 dark:from-stone-700/50 dark:to-stone-600/50'
            )}
          />

          <div className="relative z-10 space-y-4">
            <div
              className={cn(
                'inline-flex h-16 w-16 items-center justify-center rounded-2xl',
                'shadow-lg transition-transform duration-300 group-hover:scale-110',
                'border border-stone-300/50 bg-gradient-to-br from-stone-100 to-stone-200 shadow-stone-200/50 dark:border-stone-600/50 dark:bg-gradient-to-br dark:from-stone-700 dark:to-stone-600 dark:shadow-stone-900/50'
              )}
            >
              <Upload
                className={cn('h-7 w-7', 'text-stone-600 dark:text-stone-300')}
              />
            </div>

            <div className="space-y-2">
              <p
                className={cn(
                  'font-serif text-base font-semibold',
                  'text-stone-800 dark:text-stone-200'
                )}
              >
                {isUploading ? t('uploading') : t('dropOrClick')}
              </p>

              <div
                className={cn(
                  'space-y-1 font-serif text-sm',
                  'text-stone-600 dark:text-stone-400'
                )}
              >
                <p>
                  {t('maxFiles', {
                    maxFiles,
                    remaining: maxFiles - uploadFiles.length,
                  })}
                </p>
                <p>{fileTypeInfo.hint}</p>
                {getFileSizeHint() && <p>{getFileSizeHint()}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Exceeding limit hint */}
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

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple={maxFiles > 1}
        accept={fileTypeInfo.accept}
        className="hidden"
        onChange={handleFileInputChange}
        disabled={isUploading || !canUploadMore}
      />

      {/* Selected file list */}
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
              <div
                key={uploadFile.id}
                className={cn(
                  'group relative flex items-center gap-4 rounded-xl border p-4',
                  'backdrop-blur-sm transition-all duration-300 ease-in-out hover:shadow-lg',
                  'animate-in slide-in-from-top-2 fade-in duration-300',
                  'bg-gradient-to-r from-white/90 to-stone-50/90 dark:from-stone-800/90 dark:to-stone-700/90',
                  uploadFile.status === 'success' &&
                    'border-stone-400 dark:border-stone-500/50',
                  uploadFile.status === 'error' &&
                    'border-red-200 dark:border-red-700/50',
                  uploadFile.status === 'uploading' &&
                    'border-stone-400 dark:border-stone-500/50',
                  uploadFile.status === 'pending' &&
                    'border-stone-200 dark:border-stone-600'
                )}
              >
                {/* Status indicator */}
                <div className="relative flex-shrink-0">
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300',
                      uploadFile.status === 'success' &&
                        'bg-stone-200 dark:bg-stone-700/50',
                      uploadFile.status === 'error' &&
                        'bg-red-100 dark:bg-red-900/30',
                      uploadFile.status === 'uploading' &&
                        'bg-stone-200 dark:bg-stone-700/50',
                      uploadFile.status === 'pending' &&
                        'bg-stone-100 dark:bg-stone-700'
                    )}
                  >
                    {uploadFile.status === 'uploading' && <Spinner size="sm" />}
                    {uploadFile.status === 'success' && (
                      <CheckCircle2Icon
                        className={cn(
                          'h-5 w-5',
                          'text-stone-600 dark:text-stone-300'
                        )}
                      />
                    )}
                    {uploadFile.status === 'error' && (
                      <TooltipWrapper
                        content={t('retryUpload')}
                        placement="top"
                        id={`retry-${uploadFile.id}`}
                        size="sm"
                        showArrow={false}
                      >
                        <button
                          type="button"
                          onClick={() => handleRetryUpload(uploadFile.id)}
                          className={cn(
                            'flex h-full w-full items-center justify-center rounded-xl',
                            'transition-colors duration-200 focus:outline-none',
                            'text-red-600 hover:bg-red-200 dark:text-red-400 dark:hover:bg-red-800/50'
                          )}
                          aria-label={t('retryUpload')}
                        >
                          <RotateCcw className="h-5 w-5" />
                        </button>
                      </TooltipWrapper>
                    )}
                    {uploadFile.status === 'pending' && (
                      <File
                        className={cn(
                          'h-5 w-5',
                          'text-stone-600 dark:text-stone-400'
                        )}
                      />
                    )}
                  </div>

                  {/* Pulse animation (uploading) */}
                  {uploadFile.status === 'uploading' && (
                    <div className="absolute inset-0 animate-ping rounded-xl border-2 border-stone-400 opacity-30" />
                  )}
                </div>

                {/* File information */}
                <div className="min-w-0 flex-1 space-y-1">
                  <p
                    className={cn(
                      'truncate font-serif text-sm font-semibold',
                      'text-stone-800 dark:text-stone-200'
                    )}
                  >
                    {uploadFile.name}
                  </p>
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-1 font-mono text-xs',
                        'bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-400'
                      )}
                    >
                      {formatBytes(uploadFile.size)}
                    </span>

                    {uploadFile.status === 'error' && uploadFile.error && (
                      <span
                        className={cn(
                          'font-serif text-xs',
                          'text-red-600 dark:text-red-400'
                        )}
                      >
                        {uploadFile.error}
                      </span>
                    )}
                  </div>
                </div>

                {/* Delete button */}
                <TooltipWrapper
                  content={t('removeFile')}
                  placement="top"
                  id={`remove-${uploadFile.id}`}
                  size="sm"
                  showArrow={false}
                >
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(uploadFile.id)}
                    className={cn(
                      'rounded-xl p-2 opacity-0 transition-all duration-200 group-hover:opacity-100',
                      'text-stone-500 hover:bg-stone-200 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-600 dark:hover:text-stone-200'
                    )}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </TooltipWrapper>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error hint */}
      {error && (
        <div
          className={cn(
            'flex items-center gap-3 rounded-xl border p-4 shadow-lg',
            'border-red-200 bg-gradient-to-r from-red-50 to-red-100/50 shadow-red-100/50 dark:border-red-700/50 dark:bg-gradient-to-r dark:from-red-900/20 dark:to-red-800/20 dark:shadow-red-900/20'
          )}
        >
          <div className="h-2 w-2 rounded-full bg-red-500" />
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
