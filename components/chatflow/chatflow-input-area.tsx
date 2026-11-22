'use client';

import { FileUploadField } from '@components/workflow/workflow-input-form/file-upload-field';
import { FormField } from '@components/workflow/workflow-input-form/form-field';
import {
  capabilityFormFields,
  validateFormData,
} from '@components/workflow/workflow-input-form/validation';
import {
  formatChatUiError,
  isContentModerationBlocked,
  localizeChatModerationMessage,
  reportTraceableClientError,
} from '@lib/hooks/chat-interface/error-utils';
import { isChatSubmitResult } from '@lib/hooks/chat-interface/guards';
import {
  useAgentInputCapabilities,
  useRetainedInputCapabilities,
} from '@lib/hooks/use-agent-input-capabilities';
import { useChatInputApp } from '@lib/hooks/use-chat-input-app';
import { useChatWidth } from '@lib/hooks/use-chat-width';
import { getDifyUserInputFormEntry } from '@lib/services/dify/user-input-form';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useNotificationStore } from '@lib/stores/ui/notification-store';
import { cn } from '@lib/utils';
import { Workflow } from 'lucide-react';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTranslations } from 'next-intl';

import { ChatflowFormActions } from './chatflow-input-area/form-actions';
import {
  buildChatflowFormConfig,
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

export function ChatflowInputArea(props: ChatflowInputAreaProps) {
  const actorEpoch = useChatInputStore(state => state.actorEpoch);
  return (
    <ScopedChatflowInputArea
      key={JSON.stringify([props.instanceId, actorEpoch])}
      {...props}
    />
  );
}

function ScopedChatflowInputArea({
  instanceId,
  onSubmit,
  isProcessing = false,
  isWaiting = false,
  className,
  onFormConfigChange,
}: ChatflowInputAreaProps) {
  const { widthClass, paddingClass } = useChatWidth();
  const app = useChatInputApp(instanceId, true);
  const currentAppInstance = app.instance;
  const live = useAgentInputCapabilities(currentAppInstance?.id ?? null);
  const ready = live.capabilities?.status === 'ready';
  const displayedCapabilities = useRetainedInputCapabilities(live.capabilities);
  const configResult = useMemo(
    () => buildChatflowFormConfig(capabilityFormFields(displayedCapabilities)),
    [displayedCapabilities]
  );
  const { userInputForm, hasFormConfig, initialFormData } = configResult;
  const isLoading =
    !displayedCapabilities &&
    !ready &&
    !app.failed &&
    !live.error &&
    !live.capabilities;
  const [uploadBlocked, setUploadBlocked] = useState<Record<string, boolean>>(
    {}
  );
  const t = useTranslations('pages.chatflow');
  const tModeration = useTranslations('errors.system.moderation');
  const tWorkflow = useTranslations('pages.workflow.form');
  const tChat = useTranslations('pages.chat');
  const tCommon = useTranslations('common');

  const [query, setQuery] = useState('');
  const [draftFields, setFormData] = useState<ChatflowFormData>({});
  const formData = useMemo(
    () => ({ ...initialFormData, ...draftFields }),
    [initialFormData, draftFields]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    onFormConfigChange?.(ready ? hasFormConfig : true);
  }, [ready, hasFormConfig, onFormConfigChange]);

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
    setFormData(
      Object.fromEntries(
        Object.entries(initialFormData).map(([key, value]) => [
          key,
          Array.isArray(value) ? [...value] : value,
        ])
      )
    );
    setErrors({});
  }, [initialFormData]);

  const canSubmit = useCallback(() => {
    if (!ready || Object.values(uploadBlocked).some(Boolean)) return false;
    const validationErrors = validateChatflowSubmission({
      formData,
      hasFormConfig: false,
      query,
      t,
      tWorkflow,
      userInputForm,
    });
    Object.assign(
      validationErrors,
      validateFormData(formData, userInputForm, tWorkflow, live.capabilities)
    );

    return Object.keys(validationErrors).length === 0;
  }, [
    formData,
    query,
    t,
    tWorkflow,
    userInputForm,
    ready,
    uploadBlocked,
    live.capabilities,
  ]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (
        isProcessing ||
        isWaiting ||
        !ready ||
        Object.values(uploadBlocked).some(Boolean)
      ) {
        return;
      }

      const nextErrors = validateChatflowSubmission({
        formData,
        hasFormConfig: false,
        query,
        t,
        tWorkflow,
        userInputForm,
      });
      Object.assign(
        nextErrors,
        validateFormData(formData, userInputForm, tWorkflow, live.capabilities)
      );

      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      const files: UploadPayloadFile[] = [];
      setErrors({});

      try {
        const keys = new Set([
          ...live.capabilities!.fields.map(field => field.key),
          ...live
            .capabilities!.attachmentSlots.filter(
              slot => slot.target === 'inputs'
            )
            .map(slot => slot.key),
        ]);
        const submitResult = await onSubmit(
          query.trim(),
          Object.fromEntries(
            Object.entries(formData).filter(([key]) => keys.has(key))
          ),
          files
        );

        if (isChatSubmitResult(submitResult) && !submitResult.ok) {
          live.retry();
          const submitFailureMessage =
            localizeChatModerationMessage(
              {
                code: submitResult.errorCode || 'REQUEST_FAILED',
                developerMessage: submitResult.errorMessage,
              },
              (key, values) => tModeration(key, values)
            ) ||
            submitResult.errorMessage ||
            'Failed to submit chatflow request.';
          const isModerationBlocked = isContentModerationBlocked(
            submitResult.errorCode
          );

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

          if (isModerationBlocked) {
            setQuery('');
            useNotificationStore
              .getState()
              .showNotification(submitFailureMessage, 'warning', 5000);
            return;
          }

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
        live.retry();
        console.error('[ChatflowInputArea] Submission failed:', error);
        const { errorMessage, errorCode, requestId } = formatChatUiError(
          error,
          'Failed to submit chatflow request.',
          'frontend',
          {
            moderationT: (key, values) => tModeration(key, values),
          }
        );
        const isModerationBlocked = isContentModerationBlocked(errorCode);
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

        if (isModerationBlocked) {
          setQuery('');
          useNotificationStore
            .getState()
            .showNotification(errorMessage, 'warning', 5000);
          return;
        }

        useNotificationStore
          .getState()
          .showNotification(errorMessage, 'error', 5000);
      }
    },
    [
      currentAppInstance,
      formData,
      initialFormData,
      instanceId,
      isProcessing,
      isWaiting,
      onSubmit,
      query,
      t,
      tModeration,
      tWorkflow,
      userInputForm,
      ready,
      uploadBlocked,
      live,
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
          {!ready && (
            <div
              role="alert"
              className="text-sm text-amber-700 dark:text-amber-300"
            >
              {tChat(
                live.capabilities?.status === 'unsupported'
                  ? 'input.capabilitiesUnsupported'
                  : 'input.capabilitiesUnavailable'
              )}
              <button
                type="button"
                className="ml-3 underline"
                onClick={app.failed ? app.retry : live.retry}
              >
                {tCommon('ui.retry')}
              </button>
            </div>
          )}
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

          {hasFormConfig && (
            <div className="space-y-6">
              <h2 className="font-serif text-sm text-stone-600 dark:text-stone-400">
                {t('form.additionalInfo')}
              </h2>
              {userInputForm.map(item => {
                const { fieldType, fieldConfig } =
                  getDifyUserInputFormEntry(item);
                if (!fieldConfig) return null;
                const variable = fieldConfig.variable;
                if (fieldType === 'file' || fieldType === 'file-list')
                  return (
                    <FileUploadField
                      key={variable}
                      config={{}}
                      slot={
                        ready
                          ? live.capabilities?.attachmentSlots.find(
                              slot =>
                                slot.target === 'inputs' &&
                                slot.key === variable
                            )
                          : undefined
                      }
                      value={formData[variable]}
                      onChange={value => handleFieldChange(variable, value)}
                      error={errors[variable]}
                      label={fieldConfig.label}
                      required={fieldConfig.required}
                      instanceId={instanceId}
                      isSingleFileMode={fieldType === 'file'}
                      onRequirementsChanged={live.retry}
                      onBlockedChange={blocked =>
                        setUploadBlocked(prev =>
                          prev[variable] === blocked
                            ? prev
                            : { ...prev, [variable]: blocked }
                        )
                      }
                    />
                  );
                return (
                  <FormField
                    key={variable}
                    type={
                      fieldType as
                        'text-input' | 'number' | 'paragraph' | 'select'
                    }
                    config={fieldConfig}
                    value={formData[variable] as string | number}
                    onChange={value => handleFieldChange(variable, value)}
                    error={errors[variable]}
                  />
                );
              })}
            </div>
          )}

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
