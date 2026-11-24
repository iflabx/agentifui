'use client';

import { AppIntroduction } from '@components/chat-input/app-introduction';
import { AttachmentAction } from '@components/chat-input/attachment-action';
import { ChatInputView } from '@components/chat-input/view';
import {
  useAgentInputCapabilities,
  useRetainedInputCapabilities,
} from '@lib/hooks/use-agent-input-capabilities';
import { useChatInputApp } from '@lib/hooks/use-chat-input-app';
import type { DifyUserInputFormItem } from '@lib/services/dify/types';
import { getDifyUserInputFormEntry } from '@lib/services/dify/user-input-form';
import { readTaskDraft, writeTaskDraft } from '@lib/stores/chat-draft-session';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { cn } from '@lib/utils';
import { Loader2, Play } from 'lucide-react';

import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useTranslations } from 'next-intl';

import { FileUploadField, type FileUploadSelection } from './file-upload-field';
import {
  type WorkflowUploadOwner,
  getSuccessfulFilesPayload,
  restoreUploadFiles,
} from './file-upload-field/helpers';
import { FormField } from './form-field';
import { capabilityFormFields, validateFormData } from './validation';

type WorkflowFormData = Record<string, unknown>;

interface WorkflowInputFormProps {
  instanceId: string;
  onExecute: (formData: WorkflowFormData) => Promise<void | boolean>;
  isExecuting: boolean;
  chat?: boolean;
  onStop?: () => void;
  showIntroduction?: boolean;
  draftKey?: string;
}

export interface WorkflowInputFormRef {
  resetForm: () => void;
  restoreInputs?: (inputs: WorkflowFormData) => void;
}

export const WorkflowInputForm = React.forwardRef<
  WorkflowInputFormRef,
  WorkflowInputFormProps
>((props, ref) => {
  const {
    instanceId,
    onExecute,
    isExecuting,
    chat = false,
    onStop,
    showIntroduction,
    draftKey,
  } = props;
  const actorEpoch = useChatInputStore(state => state.actorEpoch);
  return (
    <ScopedWorkflowInputForm
      key={JSON.stringify([instanceId, actorEpoch])}
      ref={ref}
      instanceId={instanceId}
      onExecute={onExecute}
      isExecuting={isExecuting}
      chat={chat}
      onStop={onStop}
      showIntroduction={showIntroduction}
      draftKey={draftKey}
    />
  );
});

const ScopedWorkflowInputForm = React.forwardRef<
  WorkflowInputFormRef,
  WorkflowInputFormProps
>((props, ref) => {
  const {
    instanceId,
    onExecute,
    isExecuting,
    chat = false,
    onStop,
    showIntroduction = false,
    draftKey,
  } = props;
  const t = useTranslations('pages.workflow.form');
  const tCommon = useTranslations('common');
  const tChat = useTranslations('pages.chat');
  const app = useChatInputApp(instanceId, true);
  const live = useAgentInputCapabilities(app.instance?.id ?? null);
  const capabilities = live.capabilities;
  const ready =
    capabilities?.status === 'ready' && (!chat || capabilities.mode === 'task');
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
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const inputId = useId();
  const fileSelections = useRef(new Map<string, FileUploadSelection>());
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const [restoreScope, setRestoreScope] = useState<WorkflowUploadOwner>();
  const [initialized, setInitialized] = useState(false);
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
    if (!ready || initialized) return;
    const actor = useChatInputStore.getState();
    if (draftKey && !actor.actorId) return;
    const saved = draftKey ? readTaskDraft(draftKey) : undefined;
    const restored: WorkflowFormData = { ...defaults };
    if (saved && actor.actorId) {
      const owner = {
        app_id: instanceId,
        actor_id: actor.actorId,
        actor_epoch: actor.actorEpoch,
      };
      for (const field of capabilities.fields) {
        const value = saved[field.key];
        if (typeof value === 'string' || typeof value === 'number')
          restored[field.key] = value;
      }
      for (const slot of capabilities.attachmentSlots) {
        if (slot.target !== 'inputs') continue;
        const value = saved[slot.key];
        const files = restoreUploadFiles(
          Array.isArray(value) ? value : [value],
          owner,
          owner
        );
        if (files.length) {
          const single = !(slot.multiple ?? slot.maxCount !== 1);
          restored[slot.key] = getSuccessfulFilesPayload(
            files,
            single,
            owner
          ).value;
        }
      }
    }
    setFormData(restored);
    setInitialized(true);
  }, [ready, initialized, defaults, draftKey, instanceId, capabilities]);
  useLayoutEffect(() => {
    if (!draftKey || !initialized) return;
    const draft = Object.fromEntries(
      Object.keys(defaults).flatMap(key => {
        const value = formData[key];
        const initial = defaults[key];
        if (Array.isArray(initial)) {
          if (value == null || (Array.isArray(value) && !value.length))
            return [];
        } else if (value === undefined || value === initial) return [];
        return [[key, value]];
      })
    );
    writeTaskDraft(draftKey, draft);
  }, [draftKey, initialized, defaults, formData]);
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
  React.useImperativeHandle(
    ref,
    () => ({
      resetForm: reset,
      restoreInputs: inputs => {
        const actor = useChatInputStore.getState();
        if (!actor.actorId) return;
        const owner = {
          app_id: instanceId,
          actor_id: actor.actorId,
          actor_epoch: actor.actorEpoch,
        };
        const restored = structuredClone(inputs);
        for (const slot of capabilities?.attachmentSlots ?? []) {
          if (slot.target !== 'inputs') continue;
          const value = restored[slot.key];
          const rebind = (file: unknown) =>
            file &&
            typeof file === 'object' &&
            'app_id' in file &&
            file.app_id === instanceId &&
            'actor_id' in file &&
            file.actor_id === actor.actorId
              ? { ...file, ...owner }
              : file;
          restored[slot.key] = Array.isArray(value)
            ? value.map(rebind)
            : rebind(value);
        }
        setRestoreScope(owner);
        setFormData(restored);
        setErrors({});
      },
    }),
    [reset, instanceId, capabilities]
  );
  const blocked =
    !ready ||
    isExecuting ||
    capabilities?.attachmentSlots.some(
      slot => slot.target === 'inputs' && uploadBlocked[slot.key]
    ) ||
    Boolean(
      capabilities?.attachmentSlots.some(
        slot => slot.target === 'files' && slot.minCount > 0
      )
    );
  const submit = async () => {
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
        structuredClone(
          Object.fromEntries(
            Object.entries(formData).filter(([key]) => keys.has(key))
          )
        )
      );
      if (result === false) {
        live.retry();
      } else if (chat) {
        setFormData(previous => {
          const next = { ...previous };
          if (capabilities.text.enabled) next[capabilities.text.target] = '';
          for (const slot of capabilities.attachmentSlots) {
            if (slot.target === 'inputs') next[slot.key] = null;
          }
          return next;
        });
        setDropNotice(null);
        setRestoreScope(undefined);
      }
    } catch {
      live.retry();
    } finally {
      submitting.current = false;
    }
  };
  const retry = app.failed ? app.retry : live.retry;
  const failed = app.failed || live.error || (capabilities && !ready);
  const textTarget =
    chat && capabilities?.text.enabled ? capabilities.text.target : null;
  const textValue = textTarget ? String(formData[textTarget] ?? '') : '';
  const valid =
    ready &&
    Object.keys(validateFormData(formData, userInputForm, t, capabilities))
      .length === 0;
  const uploadFields = userInputForm.filter(item =>
    ['file', 'file-list'].includes(getDifyUserInputFormEntry(item).fieldType)
  );
  const renderUpload = (formItem: DifyUserInputFormItem) => {
    const { fieldType, fieldConfig } = getDifyUserInputFormEntry(formItem);
    if (!fieldConfig) return null;
    const variable = fieldConfig.variable;
    const slot = displayedCapabilities?.attachmentSlots.find(
      item => item.target === 'inputs' && item.key === variable
    );
    return (
      <FileUploadField
        key={variable}
        selectionRef={selection => {
          if (selection) fileSelections.current.set(variable, selection);
          else fileSelections.current.delete(variable);
        }}
        config={{}}
        compact={chat}
        showCompactLabel={uploadFields.length > 1}
        inputId={`${inputId}-${variable}`}
        disabled={isExecuting || !ready}
        slot={
          ready
            ? capabilities.attachmentSlots.find(
                item => item.target === 'inputs' && item.key === variable
              )
            : undefined
        }
        value={formData[variable]}
        restoreScope={restoreScope}
        onChange={value => {
          setFormData(previous => ({ ...previous, [variable]: value }));
          setErrors(previous => ({ ...previous, [variable]: '' }));
        }}
        error={errors[variable]}
        label={fieldConfig.label}
        instanceId={instanceId}
        required={slot ? slot.minCount > 0 : fieldConfig.required}
        isSingleFileMode={fieldType === 'file'}
        onRequirementsChanged={live.retry}
        onCountChange={count =>
          setFileCounts(previous =>
            previous[variable] === count
              ? previous
              : { ...previous, [variable]: count }
          )
        }
        onBlockedChange={value =>
          setUploadBlocked(previous =>
            previous[variable] === value
              ? previous
              : { ...previous, [variable]: value }
          )
        }
      />
    );
  };
  return (
    <div
      className={cn('flex min-h-0 flex-col', !chat && 'h-full')}
      data-task-composer={chat ? '' : undefined}
    >
      {chat && showIntroduction && (
        <AppIntroduction
          name={app.instance?.display_name}
          description={app.instance?.description}
        />
      )}
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
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
        className="hide-all-scrollbars flex min-h-0 flex-1 flex-col"
      >
        <fieldset
          disabled={isExecuting}
          inert={isExecuting}
          className={cn(
            'no-scrollbar space-y-6 overflow-x-visible overflow-y-auto px-2',
            chat ? 'max-h-[35dvh]' : 'flex-1'
          )}
        >
          {userInputForm.map((formItem: DifyUserInputFormItem) => {
            const { fieldType, fieldConfig } =
              getDifyUserInputFormEntry(formItem);
            if (!fieldConfig) return null;
            const variable = fieldConfig.variable;
            if (variable === textTarget) return null;
            const onChange = (value: unknown) => {
              setFormData(prev => ({ ...prev, [variable]: value }));
              setErrors(prev => ({ ...prev, [variable]: '' }));
            };
            if (fieldType === 'file' || fieldType === 'file-list') {
              return chat ? null : renderUpload(formItem);
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
        </fieldset>
        {chat ? (
          <div
            className="mt-3"
            onDragOver={event => {
              if (!event.dataTransfer.types.includes('Files')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect =
                ready && !isExecuting ? 'copy' : 'none';
            }}
            onDrop={event => {
              const files = Array.from(event.dataTransfer.files);
              if (!files.length && !event.dataTransfer.types.includes('Files'))
                return;
              event.preventDefault();
              event.stopPropagation();
              if (isExecuting) return;
              if (!ready) {
                setDropNotice(tChat('input.capabilitiesUnavailable'));
                return;
              }
              const slots = capabilities.attachmentSlots.filter(
                slot =>
                  slot.target === 'inputs' &&
                  slot.methods.includes('local_file') &&
                  slot.maxCount > 0
              );
              if (slots.length !== 1) {
                setDropNotice(
                  tChat(
                    slots.length
                      ? 'input.chooseAttachmentField'
                      : 'fileTypeSelector.notSupported'
                  )
                );
                return;
              }
              setDropNotice(null);
              fileSelections.current.get(slots[0].key)?.selectFiles(files);
            }}
          >
            {dropNotice && (
              <p role="status" className="mb-2 px-2 text-xs text-stone-500">
                {dropNotice}
              </p>
            )}
            <ChatInputView
              embedded
              value={textValue}
              onValueChange={value => {
                if (textTarget)
                  setFormData(previous => ({
                    ...previous,
                    [textTarget]: value,
                  }));
              }}
              onSubmit={submit}
              disabled={blocked}
              textDisabled={!textTarget}
              canSubmit={valid}
              isProcessing={isExecuting}
              onStop={onStop}
              stopDisabled={false}
              placeholder=""
              attachmentPreview={uploadFields.map(renderUpload)}
              attachmentAction={
                <AttachmentAction
                  disabled={!ready || isExecuting}
                  choices={(displayedCapabilities?.attachmentSlots ?? [])
                    .filter(slot => slot.target === 'inputs')
                    .map(slot => ({
                      id: `${inputId}-${slot.key}`,
                      slot,
                      count: fileCounts[slot.key] ?? 0,
                    }))}
                  onChoose={choice => {
                    setDropNotice(null);
                    document.getElementById(choice.id)?.click();
                  }}
                />
              }
              sendButtonAriaLabel={t('startExecution')}
            />
          </div>
        ) : (
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
        )}
      </form>
    </div>
  );
});

WorkflowInputForm.displayName = 'WorkflowInputForm';
ScopedWorkflowInputForm.displayName = 'ScopedWorkflowInputForm';
