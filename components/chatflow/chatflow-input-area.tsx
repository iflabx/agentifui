'use client';

import {
  formatChatUiError,
  reportTraceableClientError,
} from '@lib/hooks/chat-interface/error-utils';
import { isChatSubmitResult } from '@lib/hooks/chat-interface/guards';
import { useChatWidth } from '@lib/hooks/use-chat-width';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import type { DifyUserInputFormItem } from '@lib/services/dify/types';
import { useNotificationStore } from '@lib/stores/ui/notification-store';
import { cn } from '@lib/utils';
import { Workflow } from 'lucide-react';

import { useCallback, useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import { ChatflowDynamicFields } from './chatflow-input-area/dynamic-fields';
import { ChatflowFormActions } from './chatflow-input-area/form-actions';
import {
  buildChatflowFormConfig,
  extractFilesFromFormData,
  isChatflowFormPristine,
  validateChatflowSubmission,
} from './chatflow-input-area/helpers';
import { ChatflowInputLoadingState } from './chatflow-input-area/loading-state';
import { ChatflowQueryField } from './chatflow-input-area/query-field';
import type {
  ChatflowFormData,
  UploadPayloadFile,
} from './chatflow-input-area/types';

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

  const [query, setQuery] = useState('');
  const [formData, setFormData] = useState<ChatflowFormData>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [initialFormData, setInitialFormData] = useState<ChatflowFormData>({});
  const [isLoading, setIsLoading] = useState(true);
  const [userInputForm, setUserInputForm] = useState<DifyUserInputFormItem[]>(
    []
  );
  const [hasFormConfig, setHasFormConfig] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    const initializeFormConfig = async () => {
      try {
        setIsLoading(true);

        const response = await fetch(
          `/api/internal/apps?instanceId=${encodeURIComponent(instanceId)}`,
          {
            method: 'GET',
            credentials: 'include',
          }
        );

        if (!response.ok) {
          setHasFormConfig(false);
          setUserInputForm([]);
          setFormData({});
          setInitialFormData({});
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

        const formItems = payload.app?.config?.dify_parameters?.user_input_form;
        const configResult = buildChatflowFormConfig(
          payload.success ? formItems : undefined
        );

        setUserInputForm(configResult.userInputForm);
        setHasFormConfig(configResult.hasFormConfig);
        setFormData(configResult.initialFormData);
        setInitialFormData(configResult.initialFormData);
        onFormConfigChange?.(configResult.hasFormConfig);
      } catch (error) {
        console.error('[ChatflowInputArea] Initialization failed:', error);
        setHasFormConfig(false);
        setUserInputForm([]);
        setFormData({});
        setInitialFormData({});
        onFormConfigChange?.(false);
      } finally {
        setIsLoading(false);
      }
    };

    if (instanceId) {
      void initializeFormConfig();
    }
  }, [instanceId, onFormConfigChange]);

  const handleFieldChange = useCallback(
    (variable: string, value: unknown) => {
      setFormData(prev => ({
        ...prev,
        [variable]: value,
      }));

      if (errors[variable]) {
        setErrors(prev => {
          const nextErrors = { ...prev };
          delete nextErrors[variable];
          return nextErrors;
        });
      }
    },
    [errors]
  );

  const handleQueryChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setQuery(event.target.value);

      if (errors.query) {
        setErrors(prev => {
          const nextErrors = { ...prev };
          delete nextErrors.query;
          return nextErrors;
        });
      }
    },
    [errors]
  );

  const handleReset = useCallback(() => {
    setQuery('');
    setFormData({ ...initialFormData });
    setErrors({});
  }, [initialFormData]);

  const canSubmit = useCallback(() => {
    const validationErrors = validateChatflowSubmission({
      formData,
      hasFormConfig,
      query,
      t,
      tWorkflow,
      userInputForm,
    });

    return Object.keys(validationErrors).length === 0;
  }, [formData, hasFormConfig, query, t, tWorkflow, userInputForm]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (isProcessing || isWaiting) {
        return;
      }

      const nextErrors = validateChatflowSubmission({
        formData,
        hasFormConfig,
        query,
        t,
        tWorkflow,
        userInputForm,
      });

      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      const files = extractFilesFromFormData(formData);
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
            useNotificationStore
              .getState()
              .showNotification(submitFailureMessage, 'error', 5000);
          }
          return;
        }

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
          developerMessage:
            error instanceof Error ? error.message : String(error),
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
        useNotificationStore
          .getState()
          .showNotification(errorMessage, 'error', 5000);
      }
    },
    [
      currentAppInstance?.instance_id,
      formData,
      hasFormConfig,
      initialFormData,
      instanceId,
      isProcessing,
      isWaiting,
      onSubmit,
      query,
      t,
      tWorkflow,
      userInputForm,
    ]
  );

  const handleQueryKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
        event.preventDefault();

        if (!isProcessing && !isWaiting && canSubmit()) {
          const form = event.currentTarget.closest('form');
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
    [canSubmit, isComposing, isProcessing, isWaiting]
  );

  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
  }, []);

  if (isLoading) {
    return (
      <ChatflowInputLoadingState
        loadingText={t('loading.inputConfig')}
        paddingClass={paddingClass}
        widthClass={widthClass}
      />
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
      <div
        className={cn(
          'mx-auto max-w-2xl',
          'rounded-2xl shadow-xl backdrop-blur-xl transition-all duration-300',
          'border border-stone-200/60 bg-gradient-to-br from-white/95 to-stone-50/95 shadow-stone-200/40 hover:shadow-2xl hover:shadow-stone-300/50 dark:border-stone-700/60 dark:bg-gradient-to-br dark:from-stone-900/95 dark:to-stone-800/95 dark:shadow-stone-900/40 dark:hover:shadow-stone-900/60'
        )}
      >
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

        <form onSubmit={handleSubmit} className="space-y-8 p-8">
          <ChatflowQueryField
            disabled={isProcessing || isWaiting}
            error={errors.query}
            onChange={handleQueryChange}
            onCompositionEnd={handleCompositionEnd}
            onCompositionStart={handleCompositionStart}
            onKeyDown={handleQueryKeyDown}
            placeholder={t('form.question.placeholder')}
            query={query}
            requiredLabel={t('form.question.label')}
          />

          <ChatflowDynamicFields
            errors={errors}
            formData={formData}
            hasFormConfig={hasFormConfig}
            instanceId={instanceId}
            onFieldChange={handleFieldChange}
            sectionTitle={t('form.additionalInfo')}
            userInputForm={userInputForm}
          />

          <ChatflowFormActions
            canSubmit={canSubmit()}
            hasErrors={Object.keys(errors).length > 0}
            isPristine={isChatflowFormPristine(query, formData)}
            isProcessing={isProcessing}
            isWaiting={isWaiting}
            onReset={handleReset}
            resetLabel={t('form.reset')}
            submitLabel={t('form.startConversation')}
            validationHint={t('form.checkAndCorrectErrors')}
            workingLabel={t('form.processing')}
          />
        </form>
      </div>
    </div>
  );
}
