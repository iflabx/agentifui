'use client';

import {
  useAgentInputCapabilities,
  useRetainedInputCapabilities,
} from '@lib/hooks/use-agent-input-capabilities';
import { useChatInputApp } from '@lib/hooks/use-chat-input-app';
import type { DifyUserInputFormItem } from '@lib/services/dify/types';
import { getDifyUserInputFormEntry } from '@lib/services/dify/user-input-form';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { cn } from '@lib/utils';
import { Loader2, Play } from 'lucide-react';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useTranslations } from 'next-intl';

import { FileUploadField } from './file-upload-field';
import { FormField } from './form-field';
import { capabilityFormFields, validateFormData } from './validation';

type WorkflowFormData = Record<string, unknown>;

interface WorkflowInputFormProps {
  instanceId: string;
  onExecute: (formData: WorkflowFormData) => Promise<void | boolean>;
  isExecuting: boolean;
}

export interface WorkflowInputFormRef {
  resetForm: () => void;
}

export const WorkflowInputForm = React.forwardRef<
  WorkflowInputFormRef,
  WorkflowInputFormProps
>(({ instanceId, onExecute, isExecuting }, ref) => {
  const actorEpoch = useChatInputStore(state => state.actorEpoch);
  return (
    <ScopedWorkflowInputForm
      key={JSON.stringify([instanceId, actorEpoch])}
      ref={ref}
      instanceId={instanceId}
      onExecute={onExecute}
      isExecuting={isExecuting}
    />
  );
});

const ScopedWorkflowInputForm = React.forwardRef<
  WorkflowInputFormRef,
  WorkflowInputFormProps
>(({ instanceId, onExecute, isExecuting }, ref) => {
  const t = useTranslations('pages.workflow.form');
  const tCommon = useTranslations('common');
  const tChat = useTranslations('pages.chat');
  const app = useChatInputApp(instanceId, true);
  const live = useAgentInputCapabilities(app.instance?.id ?? null);
  const capabilities = live.capabilities;
  const ready = capabilities?.status === 'ready';
  const displayedCapabilities = useRetainedInputCapabilities(capabilities);
  const userInputForm = useMemo(
    () => capabilityFormFields(displayedCapabilities),
    [displayedCapabilities]
  );
  const [formData, setFormData] = useState<WorkflowFormData>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadBlocked, setUploadBlocked] = useState<Record<string, boolean>>(
    {}
  );
  const initialized = useRef(false);
  const submitting = useRef(false);
  const defaults = useMemo(
    () =>
      Object.fromEntries(
        userInputForm.map(item => {
          const { fieldConfig } = getDifyUserInputFormEntry(item);
          return [fieldConfig!.variable, fieldConfig!.default ?? ''];
        })
      ),
    [userInputForm]
  );
  useEffect(() => {
    if (ready && !initialized.current) {
      initialized.current = true;
      setFormData(defaults);
    }
  }, [ready, defaults]);
  const reset = useCallback(() => {
    setFormData(
      Object.fromEntries(
        Object.entries(defaults).map(([key, value]) => [
          key,
          Array.isArray(value) ? [...value] : value,
        ])
      )
    );
    setErrors({});
  }, [defaults]);
  React.useImperativeHandle(ref, () => ({ resetForm: reset }), [reset]);
  const blocked =
    !ready ||
    isExecuting ||
    Object.values(uploadBlocked).some(Boolean) ||
    Boolean(
      capabilities?.attachmentSlots.some(
        slot => slot.target === 'files' && slot.minCount > 0
      )
    );
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (blocked || submitting.current) return;
    const validation = validateFormData(
      formData,
      userInputForm,
      t,
      capabilities
    );
    setErrors(validation);
    if (Object.keys(validation).length) return;
    submitting.current = true;
    try {
      const keys = new Set([
        ...capabilities!.fields.map(field => field.key),
        ...capabilities!.attachmentSlots
          .filter(slot => slot.target === 'inputs')
          .map(slot => slot.key),
      ]);
      const result = await onExecute(
        Object.fromEntries(
          Object.entries(formData).filter(([key]) => keys.has(key))
        )
      );
      if (result === false) live.retry();
    } catch {
      live.retry();
    } finally {
      submitting.current = false;
    }
  };
  const retry = app.failed ? app.retry : live.retry;
  const failed = app.failed || live.error || (capabilities && !ready);
  return (
    <div className="flex h-full flex-col">
      {!ready && (
        <div
          role={failed ? 'alert' : 'status'}
          className="space-y-3 px-2 py-4 font-serif text-sm text-stone-600 dark:text-stone-400"
        >
          {failed
            ? tChat(
                capabilities?.status === 'unsupported'
                  ? 'input.capabilitiesUnsupported'
                  : 'input.capabilitiesUnavailable'
              )
            : t('loading')}
          {failed ? (
            <button type="button" onClick={retry} className="ml-3 underline">
              {tCommon('ui.retry')}
            </button>
          ) : (
            <Loader2 className="inline h-4 w-4 animate-spin" />
          )}
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="hide-all-scrollbars flex min-h-0 flex-1 flex-col"
      >
        <div className="no-scrollbar flex-1 space-y-6 overflow-x-visible overflow-y-auto px-2">
          {userInputForm.map((formItem: DifyUserInputFormItem) => {
            const { fieldType, fieldConfig } =
              getDifyUserInputFormEntry(formItem);
            if (!fieldConfig) return null;
            const variable = fieldConfig.variable;
            const onChange = (value: unknown) => {
              setFormData(prev => ({ ...prev, [variable]: value }));
              setErrors(prev => ({ ...prev, [variable]: '' }));
            };
            if (fieldType === 'file' || fieldType === 'file-list') {
              const slot = displayedCapabilities?.attachmentSlots.find(
                slot => slot.target === 'inputs' && slot.key === variable
              );
              const liveSlot = ready
                ? capabilities.attachmentSlots.find(
                    slot => slot.target === 'inputs' && slot.key === variable
                  )
                : undefined;
              return (
                <FileUploadField
                  key={variable}
                  config={{}}
                  slot={liveSlot}
                  value={formData[variable]}
                  onChange={onChange}
                  error={errors[variable]}
                  label={fieldConfig.label}
                  instanceId={instanceId}
                  required={slot ? slot.minCount > 0 : fieldConfig.required}
                  isSingleFileMode={fieldType === 'file'}
                  onRequirementsChanged={live.retry}
                  onBlockedChange={value =>
                    setUploadBlocked(prev =>
                      prev[variable] === value
                        ? prev
                        : { ...prev, [variable]: value }
                    )
                  }
                />
              );
            }
            return (
              <FormField
                key={variable}
                type={
                  fieldType as 'text-input' | 'number' | 'paragraph' | 'select'
                }
                config={fieldConfig}
                value={
                  (formData[variable] ?? defaults[variable] ?? '') as
                    string | number | string[] | File[]
                }
                onChange={onChange}
                error={errors[variable]}
              />
            );
          })}
        </div>
        <div className="mt-4 flex-shrink-0 border-t border-stone-200 bg-gradient-to-t pt-6 dark:border-stone-700">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={reset}
              disabled={isExecuting}
              className="rounded-lg border border-stone-300 px-4 py-2 font-serif text-sm text-stone-700 dark:border-stone-600 dark:text-stone-300"
            >
              {t('reset')}
            </button>
            <button
              type="submit"
              disabled={blocked}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg bg-stone-800 px-6 py-2 font-serif text-sm font-medium text-white dark:bg-stone-700',
                blocked && 'cursor-not-allowed opacity-50'
              )}
            >
              {isExecuting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {isExecuting ? t('executing') : t('startExecution')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
});

WorkflowInputForm.displayName = 'WorkflowInputForm';
ScopedWorkflowInputForm.displayName = 'ScopedWorkflowInputForm';
