'use client';

import {
  formatChatUiError,
  reportTraceableClientError,
} from '@lib/hooks/chat-interface/error-utils';
import { isChatSubmitResult } from '@lib/hooks/chat-interface/guards';
import type { ChatSubmitResult } from '@lib/hooks/chat-interface/types';
import { FileUploadField } from '@components/workflow/workflow-input-form/file-upload-field';
import { FormField } from '@components/workflow/workflow-input-form/form-field';
import { validateFormData } from '@components/workflow/workflow-input-form/validation';
import { useChatWidth } from '@lib/hooks/use-chat-width';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import type { DifyUserInputFormItem } from '@lib/services/dify/types';
import { useNotificationStore } from '@lib/stores/ui/notification-store';
import { cn } from '@lib/utils';
import { Loader2, RotateCcw, Send, Workflow } from 'lucide-react';

import React, { useCallback, useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

type ChatflowFormData = Record<string, unknown>;
type UploadPayloadFile = {
  file?: unknown;
  upload_file_id?: unknown;
} & Record<string, unknown>;

interface ChatflowInputAreaProps {
  instanceId: string;
  onSubmit: (
    query: string,
    inputs: ChatflowFormData,
    files?: UploadPayloadFile[]
  ) => Promise<unknown> | unknown;
  isProcessing?: boolean;
  isWaiting?: boolean;
  className?: string;
  onFormConfigChange?: (hasFormConfig: boolean) => void;
}

/**
 * Chatflow input area component
 *
 * Features:
 * - Always includes a query input field (sys.query)
 * - Display dynamic form fields based on application configuration
 * - Complete form validation (required fields, file types, etc.)
 * - Correctly build chat-messages API payload
 */
export function ChatflowInputArea({
  instanceId,
  onSubmit,
  isProcessing = false,
  isWaiting = false,
  className,
  onFormConfigChange,
}: ChatflowInputAreaProps) {
  const { widthClass, paddingClass } = useChatWidth();
  const { currentAppInstance } = useCurrentApp();
  const t = useTranslations('pages.chatflow');
  const tWorkflow = useTranslations('pages.workflow.form');

  // --- State management ---
  const [query, setQuery] = useState('');
  const [formData, setFormData] = useState<ChatflowFormData>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [initialFormData, setInitialFormData] = useState<ChatflowFormData>({});
  const [isLoading, setIsLoading] = useState(true);
  const [userInputForm, setUserInputForm] = useState<DifyUserInputFormItem[]>(
    []
  );
  const [hasFormConfig, setHasFormConfig] = useState(false);

  // --- Initialize application configuration ---
  useEffect(() => {
    const initializeFormConfig = async () => {
      try {
        setIsLoading(true);

        // Get application configuration from internal API
        const response = await fetch(
          `/api/internal/apps?instanceId=${encodeURIComponent(instanceId)}`,
          {
            method: 'GET',
            credentials: 'include',
          }
        );

        if (!response.ok) {
          console.warn(
            '[ChatflowInputArea] Service instance not found, using pure query mode'
          );
          setHasFormConfig(false);
          onFormConfigChange?.(false);
          return;
        }

        const payload = (await response.json()) as {
          success: boolean;
          app?: {
            config?: {
              dify_parameters?: {
                user_input_form?: DifyUserInputFormItem[];
              };
            };
          };
        };

        const serviceInstance = payload.app;
        if (!payload.success || !serviceInstance) {
          console.warn(
            '[ChatflowInputArea] Service instance not found, using pure query mode'
          );
          setHasFormConfig(false);
          onFormConfigChange?.(false);
          return;
        }

        // Parse user_input_form configuration
        const difyParams = serviceInstance.config?.dify_parameters;
        const formItems = difyParams?.user_input_form || [];

        if (Array.isArray(formItems) && formItems.length > 0) {
          setUserInputForm(formItems);
          setHasFormConfig(true);
          onFormConfigChange?.(true);

          // Initialize form default values
          const initialData: ChatflowFormData = {};
          formItems.forEach((formItem: DifyUserInputFormItem) => {
            const fieldType = Object.keys(formItem)[0];
            const fieldConfig = formItem[fieldType as keyof typeof formItem];

            if (fieldConfig) {
              if (fieldType === 'file' || fieldType === 'file-list') {
                initialData[fieldConfig.variable] = fieldConfig.default || [];
              } else if (fieldType === 'number') {
                const numberDefault = fieldConfig.default;
                initialData[fieldConfig.variable] =
                  typeof numberDefault === 'number' ||
                  typeof numberDefault === 'string'
                    ? numberDefault
                    : '';
              } else {
                initialData[fieldConfig.variable] = fieldConfig.default || '';
              }
            }
          });

          setFormData(initialData);
          setInitialFormData(initialData);
        } else {
          setHasFormConfig(false);
          onFormConfigChange?.(false);
        }
      } catch (error) {
        console.error('[ChatflowInputArea] Initialization failed:', error);
        setHasFormConfig(false);
        onFormConfigChange?.(false);
      } finally {
        setIsLoading(false);
      }
    };

    if (instanceId) {
      initializeFormConfig();
    }
  }, [instanceId, onFormConfigChange]);

  // --- Form field update ---
  const handleFieldChange = useCallback(
    (variable: string, value: unknown) => {
      setFormData(prev => ({
        ...prev,
        [variable]: value,
      }));

      // Clear the error of this field
      if (errors[variable]) {
        setErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors[variable];
          return newErrors;
        });
      }
    },
    [errors]
  );

  // --- Input method composition state management ---
  const [isComposing, setIsComposing] = useState(false);

  // --- Query input update ---
  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setQuery(e.target.value);

      // Clear the error of the query field
      if (errors.query) {
        setErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors.query;
          return newErrors;
        });
      }
    },
    [errors]
  );

  // --- Form reset ---
  const handleReset = useCallback(() => {
    setQuery('');
    setFormData({ ...initialFormData });
    setErrors({});
  }, [initialFormData]);

  // --- Form submission ---
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (isProcessing || isWaiting) return;

      const newErrors: Record<string, string> = {};

      // Verify the query field (required)
      if (!query.trim()) {
        newErrors.query = t('form.question.required');
      } else {
        // Check the length limit of the query field (if any)
        // Note: Here we set a reasonable default maximum length to prevent excessive input
        const maxQueryLength = 2000; // Set a reasonable query maximum length
        if (query.length > maxQueryLength) {
          newErrors.query = t('form.question.tooLong', {
            maxLength: maxQueryLength,
          });
        }
      }

      // Verify the form fields (if any)
      if (hasFormConfig && userInputForm.length > 0) {
        const formValidationErrors = validateFormData(
          formData,
          userInputForm,
          tWorkflow
        );
        Object.assign(newErrors, formValidationErrors);
      }

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }

      // Extract files
      const files = extractFilesFromFormData(formData);

      // Clear errors and submit
      setErrors({});

      try {
        const submitResult = await onSubmit(query.trim(), formData, files);

        if (isChatSubmitResult(submitResult) && !submitResult.ok) {
          const submitFailureMessage =
            submitResult.errorMessage || 'Failed to submit chatflow request.';

          void reportTraceableClientError({
            code: submitResult.errorCode || 'CHATFLOW_SUBMIT_FAILED',
            userMessage: submitFailureMessage,
            developerMessage: 'ChatflowInputArea submission returned ok=false',
            requestId: submitResult.requestId,
            context: {
              component: 'chatflow-input-area',
              phase: 'submit_result',
              instanceId,
              currentAppInstanceId: currentAppInstance?.instance_id || null,
              queryLength: query.trim().length,
              fileCount: files.length,
              surfaced: Boolean(submitResult.surfaced),
            },
          });

          if (!submitResult.surfaced) {
            useNotificationStore.getState().showNotification(
              submitFailureMessage,
              'error',
              5000
            );
          }
          return;
        }

        // Clear the form after successful submission
        setQuery('');
        setFormData({ ...initialFormData });
      } catch (error) {
        console.error('[ChatflowInputArea] Submission failed:', error);
        const { errorMessage, errorCode, requestId } = formatChatUiError(
          error,
          'Failed to submit chatflow request.',
          'frontend'
        );
        void reportTraceableClientError({
          code: errorCode || 'CHATFLOW_SUBMIT_THROWN',
          userMessage: errorMessage,
          developerMessage: error instanceof Error ? error.message : String(error),
          requestId,
          context: {
            component: 'chatflow-input-area',
            phase: 'submit_throw',
            instanceId,
            currentAppInstanceId: currentAppInstance?.instance_id || null,
            queryLength: query.trim().length,
            fileCount: files.length,
          },
        });
        useNotificationStore.getState().showNotification(
          errorMessage,
          'error',
          5000
        );
      }
    },
    [
      query,
      formData,
      userInputForm,
      hasFormConfig,
      isProcessing,
      isWaiting,
      onSubmit,
      initialFormData,
    ]
  );

  // --- Check if it can be submitted ---
  const canSubmit = useCallback(() => {
    if (!query.trim()) return false;

    if (hasFormConfig && userInputForm.length > 0) {
      const formValidationErrors = validateFormData(
        formData,
        userInputForm,
        tWorkflow
      );
      return Object.keys(formValidationErrors).length === 0;
    }

    return true;
  }, [query, formData, userInputForm, hasFormConfig]);

  // --- Keyboard event handling: Enter submission, Shift+Enter line break ---
  const handleQueryKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
        e.preventDefault();

        // Check if it can be submitted
        if (!isProcessing && !isWaiting && canSubmit()) {
          // Create a simulated form event to trigger submission
          const form = e.currentTarget.closest('form');
          if (form) {
            const submitEvent = new Event('submit', {
              bubbles: true,
              cancelable: true,
            });
            form.dispatchEvent(submitEvent);
          }
        }
      }
    },
    [isProcessing, isWaiting, canSubmit, isComposing]
  );

  // --- Input method composition event handling ---
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
  }, []);

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className={cn('mx-auto w-full', widthClass, paddingClass, 'py-8')}>
        <div className="flex items-center justify-center">
          <div className="space-y-4 text-center">
            <Loader2
              className={cn(
                'mx-auto h-6 w-6 animate-spin',
                'text-stone-500 dark:text-stone-400'
              )}
            />
            <p
              className={cn(
                'font-serif text-sm',
                'text-stone-500 dark:text-stone-400'
              )}
            >
              {t('loading.inputConfig')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'mx-auto w-full',
        widthClass,
        paddingClass,
        'py-8',
        className
      )}
    >
      {/* --- Modern form container --- */}
      <div
        className={cn(
          'mx-auto max-w-2xl',
          'rounded-2xl shadow-xl backdrop-blur-xl transition-all duration-300',
          'border border-stone-200/60 bg-gradient-to-br from-white/95 to-stone-50/95 shadow-stone-200/40 hover:shadow-2xl hover:shadow-stone-300/50 dark:border-stone-700/60 dark:bg-gradient-to-br dark:from-stone-900/95 dark:to-stone-800/95 dark:shadow-stone-900/40 dark:hover:shadow-stone-900/60'
        )}
      >
        {/* --- Form header --- */}
        <div
          className={cn(
            'border-b p-8 pb-6',
            'border-stone-200/50 dark:border-stone-700/50'
          )}
        >
          <div className="space-y-4 text-center">
            <div
              className={cn(
                'inline-flex h-16 w-16 items-center justify-center rounded-2xl',
                'shadow-lg',
                'border border-stone-300/50 bg-gradient-to-br from-stone-100 to-stone-200 shadow-stone-200/50 dark:border-stone-600/50 dark:bg-gradient-to-br dark:from-stone-800 dark:to-stone-700 dark:shadow-stone-900/50'
              )}
            >
              <Workflow
                className={cn('h-7 w-7', 'text-stone-600 dark:text-stone-300')}
              />
            </div>

            <div className="space-y-2">
              <h1
                className={cn(
                  'font-serif text-2xl font-bold',
                  'text-stone-800 dark:text-stone-200'
                )}
              >
                {currentAppInstance?.display_name || t('form.defaultAppName')}
              </h1>
              <p
                className={cn(
                  'mx-auto max-w-md font-serif leading-relaxed',
                  'text-stone-600 dark:text-stone-400'
                )}
              >
                {currentAppInstance?.description ||
                  t('form.defaultDescription')}
              </p>
            </div>
          </div>
        </div>

        {/* --- Form content area --- */}
        <form onSubmit={handleSubmit} className="space-y-8 p-8">
          {/* --- Main query input area --- */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'h-2 w-2 rounded-full',
                  'bg-gradient-to-r from-stone-500 to-stone-400'
                )}
              />
              <label
                className={cn(
                  'font-serif text-base font-semibold',
                  'text-stone-800 dark:text-stone-200'
                )}
              >
                {t('form.question.label')}{' '}
                <span className="ml-1 text-red-500">*</span>
              </label>
            </div>

            <div className="group relative">
              <textarea
                value={query}
                onChange={handleQueryChange}
                onKeyDown={handleQueryKeyDown}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                placeholder={t('form.question.placeholder')}
                rows={4}
                className={cn(
                  'w-full resize-none rounded-xl border-2 px-5 py-4 font-serif',
                  'backdrop-blur-sm transition-all duration-300',
                  'focus:border-stone-500 focus:ring-4 focus:ring-stone-500/20 focus:outline-none',
                  'focus:shadow-lg focus:shadow-stone-500/25',
                  errors.query
                    ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                    : 'border-stone-300 bg-white/80 text-stone-900 group-hover:border-stone-400 placeholder:text-stone-500 focus:bg-white dark:border-stone-600 dark:bg-stone-800/80 dark:text-stone-100 dark:group-hover:border-stone-500 dark:placeholder:text-stone-400 dark:focus:bg-stone-800'
                )}
                disabled={isProcessing || isWaiting}
              />

              {errors.query && (
                <div
                  className={cn(
                    'mt-3 flex items-center gap-2',
                    'text-red-600 dark:text-red-400'
                  )}
                >
                  <div className="h-1 w-1 rounded-full bg-red-500" />
                  <p className="font-serif text-sm">{errors.query}</p>
                </div>
              )}
            </div>
          </div>

          {/* --- Dynamic form field area --- */}
          {hasFormConfig && userInputForm.length > 0 && (
            <div className="space-y-6">
              {/* Separator line */}
              <div className="flex items-center gap-4">
                <div
                  className={cn(
                    'h-px flex-1 bg-gradient-to-r from-transparent to-transparent',
                    'via-stone-300 dark:via-stone-600'
                  )}
                />
                <span
                  className={cn(
                    'rounded-full border px-4 py-2 font-serif text-sm',
                    'border-stone-200 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400'
                  )}
                >
                  {t('form.additionalInfo')}
                </span>
                <div
                  className={cn(
                    'h-px flex-1 bg-gradient-to-r from-transparent to-transparent',
                    'via-stone-300 dark:via-stone-600'
                  )}
                />
              </div>

              {/* Form field grid */}
              <div className="grid gap-6">
                {userInputForm.map(
                  (formItem: DifyUserInputFormItem, index: number) => {
                    const fieldType = Object.keys(formItem)[0];
                    const fieldConfig =
                      formItem[fieldType as keyof typeof formItem];

                    if (!fieldConfig) return null;

                    return (
                      <div
                        key={`${fieldConfig.variable}-${index}`}
                        className={cn(
                          'group relative rounded-xl p-6 transition-all duration-300',
                          'border border-stone-200/60 bg-gradient-to-br from-stone-50/80 to-white/80 hover:border-stone-300 hover:shadow-lg hover:shadow-stone-200/50 dark:border-stone-600/60 dark:bg-gradient-to-br dark:from-stone-800/80 dark:to-stone-700/80 dark:hover:border-stone-500 dark:hover:shadow-lg dark:hover:shadow-stone-900/50'
                        )}
                      >
                        {/* Field decoration line */}
                        <div
                          className={cn(
                            'absolute top-0 left-6 h-1 w-12 rounded-full transition-all duration-300 group-hover:w-16',
                            'bg-gradient-to-r from-stone-400 to-stone-300 dark:bg-gradient-to-r dark:from-stone-500 dark:to-stone-600'
                          )}
                        />

                        {/* File upload field */}
                        {fieldType === 'file' || fieldType === 'file-list' ? (
                          <FileUploadField
                            config={
                              fieldConfig as {
                                enabled?: boolean;
                                max_length?: number;
                                number_limits?: number;
                                allowed_file_types?: string[];
                                max_file_size_mb?: number;
                              }
                            }
                            value={formData[fieldConfig.variable]}
                            onChange={value =>
                              handleFieldChange(fieldConfig.variable, value)
                            }
                            error={errors[fieldConfig.variable]}
                            label={fieldConfig.label}
                            instanceId={instanceId}
                            isSingleFileMode={fieldType === 'file'}
                          />
                        ) : (
                          <FormField
                            type={
                              fieldType as
                                | 'text-input'
                                | 'number'
                                | 'paragraph'
                                | 'select'
                            }
                            config={fieldConfig}
                            value={
                              formData[fieldConfig.variable] as
                                | string
                                | number
                                | string[]
                                | File[]
                            }
                            onChange={value =>
                              handleFieldChange(fieldConfig.variable, value)
                            }
                            error={errors[fieldConfig.variable]}
                          />
                        )}
                      </div>
                    );
                  }
                )}
              </div>
            </div>
          )}

          {/* --- Form operation area --- */}
          <div
            className={cn(
              'border-t pt-6',
              'border-stone-200/50 dark:border-stone-700/50'
            )}
          >
            <div className="flex flex-col gap-4 sm:flex-row">
              {/* Reset button */}
              <button
                type="button"
                onClick={handleReset}
                disabled={
                  isProcessing ||
                  isWaiting ||
                  (!query &&
                    Object.values(formData).every(
                      v => !v || (Array.isArray(v) && v.length === 0)
                    ))
                }
                className={cn(
                  'flex items-center justify-center gap-3 rounded-xl px-6 py-3',
                  'border-2 font-serif text-sm font-medium backdrop-blur-sm transition-all duration-300',
                  'border-stone-300 bg-white/80 text-stone-700 dark:border-stone-600 dark:bg-stone-800/80 dark:text-stone-300',
                  isProcessing ||
                    isWaiting ||
                    (!query &&
                      Object.values(formData).every(
                        v => !v || (Array.isArray(v) && v.length === 0)
                      ))
                    ? 'cursor-not-allowed opacity-50'
                    : cn(
                        'transform active:scale-[0.98]',
                        'hover:border-stone-400 hover:bg-stone-50 hover:shadow-lg hover:shadow-stone-200/50 dark:hover:border-stone-500 dark:hover:bg-stone-700 dark:hover:shadow-lg dark:hover:shadow-stone-900/50'
                      )
                )}
              >
                <RotateCcw className="h-4 w-4" />
                {t('form.reset')}
              </button>

              {/* Submit button */}
              <button
                type="submit"
                disabled={isProcessing || isWaiting || !canSubmit()}
                className={cn(
                  'flex flex-1 items-center justify-center gap-3 rounded-xl px-8 py-4',
                  'font-serif text-base font-semibold text-white shadow-lg transition-all duration-300',
                  'bg-gradient-to-r from-stone-800 to-stone-700 shadow-stone-800/25 dark:bg-gradient-to-r dark:from-stone-700 dark:to-stone-600 dark:shadow-stone-900/50',
                  isProcessing || isWaiting || !canSubmit()
                    ? 'cursor-not-allowed opacity-50'
                    : cn(
                        'transform hover:scale-[1.02] active:scale-[0.98]',
                        'hover:from-stone-700 hover:to-stone-600 hover:shadow-xl hover:shadow-stone-800/30 dark:hover:from-stone-600 dark:hover:to-stone-500 dark:hover:shadow-xl dark:hover:shadow-stone-900/60'
                      )
                )}
              >
                {isProcessing || isWaiting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>{t('form.processing')}</span>
                  </>
                ) : (
                  <>
                    <Send className="h-5 w-5" />
                    <span>{t('form.startConversation')}</span>
                  </>
                )}
              </button>
            </div>

            {/* Form error prompt */}
            {Object.keys(errors).length > 0 && (
              <div
                className={cn(
                  'mt-6 rounded-xl border p-4 shadow-lg',
                  'border-red-200 bg-gradient-to-r from-red-50 to-red-100/50 shadow-red-100/50 dark:border-red-700/50 dark:bg-gradient-to-r dark:from-red-900/20 dark:to-red-800/20 dark:shadow-red-900/20'
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-red-500" />
                  <p
                    className={cn(
                      'font-serif text-sm',
                      'text-red-700 dark:text-red-300'
                    )}
                  >
                    {t('form.checkAndCorrectErrors')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Extract files from form data
 */
function isUploadPayloadFile(value: unknown): value is UploadPayloadFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return 'file' in record || 'upload_file_id' in record;
}

function extractFilesFromFormData(
  formData: ChatflowFormData
): UploadPayloadFile[] {
  const files: UploadPayloadFile[] = [];

  Object.values(formData).forEach(value => {
    if (Array.isArray(value)) {
      // Check if it is an array of files
      value.forEach(item => {
        if (isUploadPayloadFile(item)) {
          files.push(item);
        }
      });
    } else if (isUploadPayloadFile(value)) {
      files.push(value);
    }
  });

  return files;
}
