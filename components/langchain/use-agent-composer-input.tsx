'use client';

import {
  AttachmentAction,
  attachmentAccept,
} from '@components/chat-input/attachment-action';
import { AttachmentPreviewItem } from '@components/chat-input/attachment-preview-item';
import {
  uploadScopedAttachment,
  uploadValidationMessage,
} from '@components/chat-input/use-uploads';
import {
  useAgentInputCapabilities,
  useRetainedInputCapabilities,
} from '@lib/hooks/use-agent-input-capabilities';
import { useComposerParameterDraft } from '@lib/hooks/use-composer-parameter-draft';
import {
  AgentRequestError,
  agentInputRequirementsChanged,
  agentRequest,
} from '@lib/services/client/langchain-api';
import type {
  AgentInputFile,
  AgentTurnInputs,
} from '@lib/services/client/langchain-api';
import {
  type AttachmentFile,
  useAttachmentStore,
} from '@lib/stores/attachment-store';
import { useLangchainDraftStore } from '@lib/stores/langchain-draft-store';

import { useEffect, useId, useLayoutEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  type AgentAttachmentSlot,
  type AgentInputField,
  validateInputFile,
} from '../../packages/shared/src/agent-input';

const noFiles: AttachmentFile[] = [];
function fieldValue(
  field: AgentInputField,
  values: Record<string, string | number>
) {
  return String(values[field.key] ?? field.default ?? '');
}

function fieldValid(field: AgentInputField, value: string) {
  if (!value.trim()) return !field.required;
  if (field.type === 'select') return field.options?.includes(value) === true;
  if (field.type !== 'number')
    return value.length <= (field.maxLength ?? Infinity);
  const number = Number(value);
  return (
    Number.isFinite(number) &&
    number >= (field.min ?? -Infinity) &&
    number <= (field.max ?? Infinity)
  );
}

function ParameterField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: AgentInputField;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const attributes = {
    value,
    onChange: (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) => onChange(event.target.value),
    disabled,
    required: field.required,
    className:
      'mt-1 w-full rounded-md border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-600',
  };
  return (
    <label className="block text-sm">
      {field.label}
      {field.type === 'select' ? (
        <select {...attributes}>
          <option value="" />
          {field.options?.map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === 'paragraph' ? (
        <textarea {...attributes} maxLength={field.maxLength} />
      ) : (
        <input
          {...attributes}
          type={field.type === 'number' ? 'number' : 'text'}
          min={field.min}
          max={field.max}
          step={field.step ?? 'any'}
          maxLength={field.maxLength}
        />
      )}
    </label>
  );
}

export function useAgentComposerInput({
  appId,
  actorId,
  scope,
  enabled,
  disabled,
  content,
  submissionError,
}: {
  appId: string;
  actorId: string;
  scope: string | null;
  enabled: boolean;
  disabled: boolean;
  content: string;
  submissionError?: AgentRequestError | null;
}) {
  const t = useTranslations('pages.chat');
  const tCommon = useTranslations('common.ui');
  const id = useId();
  const actorEpoch = useLangchainDraftStore(state => state.actorEpoch);
  const input = useAgentInputCapabilities(enabled ? appId : null);
  const capabilities = input.capabilities;
  const displayedCapabilities = useRetainedInputCapabilities(capabilities);
  const refreshCapabilities = input.retry;
  const requirementsChanged = agentInputRequirementsChanged(
    submissionError?.detail?.code
  );
  useEffect(() => {
    if (enabled && requirementsChanged) refreshCapabilities();
  }, [enabled, requirementsChanged, submissionError, refreshCapabilities]);
  const filesByScope = useAttachmentStore(state => state.filesByScope);
  const parameterDraft = useComposerParameterDraft('agent-parameters', scope);
  const [uploadError, setUploadError] = useState<{
    scope: string;
    message: string;
  }>();
  const activeScope = scope ?? '';
  const values = parameterDraft.values;
  const slots = displayedCapabilities?.attachmentSlots ?? [];
  const choices = slots.map((slot, index) => {
    const key = JSON.stringify([
      'agent-input',
      activeScope,
      slot.target,
      slot.key,
    ]);
    const files = filesByScope[key] ?? noFiles;
    return {
      id: `${id}-${index}`,
      scope: key,
      slot,
      files,
      count: files.length,
    };
  });
  const fields = capabilities?.fields ?? [];
  const ready = enabled && capabilities?.status === 'ready';
  useLayoutEffect(() => {
    if (scope)
      for (const choice of choices)
        useAttachmentStore.getState().restoreFiles(choice.scope);
  });
  const isCurrentActor = () => {
    const current = useLangchainDraftStore.getState();
    return current.actorId === actorId && current.actorEpoch === actorEpoch;
  };
  const transfer = (
    entry: { scope: string; slot: AgentAttachmentSlot },
    draftId: string
  ) => {
    const current = useAttachmentStore
      .getState()
      .getFiles(entry.scope)
      .find(file => file.id === draftId);
    if (!ready || !current?.file || validateInputFile(entry.slot, current.file))
      return;
    return uploadScopedAttachment({
      scope: entry.scope,
      draftId,
      appId,
      actorId,
      actorEpoch,
      isCurrentActor,
      transfer: file => {
        const form = new FormData();
        form.set('file', file);
        form.set('slotKey', entry.slot.key);
        return agentRequest<AgentInputFile>(appId, '/files', {
          method: 'POST',
          body: form,
        });
      },
      onError: error => {
        if (
          error instanceof AgentRequestError &&
          agentInputRequirementsChanged(error.detail?.code)
        )
          refreshCapabilities();
        return t('input.uploadFailed');
      },
    });
  };
  const textDisabled = ready && capabilities.text.enabled === false;
  const hasText = !textDisabled && Boolean(content.trim());
  const fieldInputs = Object.fromEntries(
    fields.flatMap(field => {
      const value = fieldValue(field, values);
      return value.trim()
        ? [[field.key, field.type === 'number' ? Number(value) : value]]
        : [];
    })
  );
  const canSubmit = !enabled
    ? hasText
    : Boolean(
        ready &&
        (!capabilities.text.required || hasText) &&
        fields.every(field => fieldValid(field, fieldValue(field, values))) &&
        choices.every(
          entry =>
            entry.count >= entry.slot.minCount &&
            entry.count <= entry.slot.maxCount &&
            entry.files.every(
              file =>
                file.status === 'success' &&
                file.uploadedId &&
                !validateInputFile(entry.slot, file.file ?? file)
            )
        ) &&
        (hasText ||
          Object.keys(fieldInputs).length ||
          choices.some(entry => entry.count))
      );

  const configuredInput = () => {
    if (!ready || !canSubmit) return undefined;
    const files = choices.flatMap(entry =>
      entry.files.map(file => ({
        id: file.uploadedId!,
        name: file.name,
        size: file.size,
        type: file.type,
      }))
    );
    const inputs: AgentTurnInputs = {
      ...(Object.keys(fieldInputs).length ? { inputs: fieldInputs } : {}),
      ...(files.length
        ? {
            attachments: choices.flatMap(entry =>
              entry.files.map(file => ({
                fileId: file.uploadedId!,
                slotKey: entry.slot.key,
              }))
            ),
          }
        : {}),
    };
    return {
      inputs,
      files,
      fileDrafts: choices
        .filter(entry => entry.count)
        .map(entry => ({ scope: entry.scope, files: entry.files })),
    };
  };

  return {
    canSubmit,
    textDisabled,
    configuredInput,
    parameters:
      ready && fields.length > 0 ? (
        <div className="space-y-2 px-4 pb-3">
          {fields.map(field => (
            <ParameterField
              key={field.key}
              field={field}
              value={fieldValue(field, values)}
              disabled={disabled}
              onChange={value => parameterDraft.setValue(field.key, value)}
            />
          ))}
        </div>
      ) : null,
    action: (
      <>
        <AttachmentAction
          choices={choices}
          disabled={disabled || !ready}
          status={
            enabled
              ? input.isLoading
                ? 'loading'
                : !ready
                  ? 'unavailable'
                  : undefined
              : undefined
          }
          onChoose={choice => document.getElementById(choice.id)?.click()}
        />
        {choices.map(entry => (
          <input
            key={entry.id}
            id={entry.id}
            type="file"
            aria-hidden="true"
            tabIndex={-1}
            className="sr-only"
            multiple={entry.slot.maxCount > 1}
            accept={attachmentAccept(entry.slot)}
            onChange={event => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (
                !scope ||
                !ready ||
                disabled ||
                !isCurrentActor() ||
                !files.length
              )
                return;
              const result = useAttachmentStore
                .getState()
                .reserveFiles(files, entry.slot, entry.scope);
              setUploadError(
                result.error
                  ? {
                      scope: activeScope,
                      message: uploadValidationMessage(
                        result.error,
                        entry.slot,
                        t
                      ),
                    }
                  : undefined
              );
              for (const draftId of result.ids) void transfer(entry, draftId);
            }}
          />
        ))}
      </>
    ),
    preview: choices.some(entry => entry.count) ? (
      <div className="flex flex-wrap gap-2 p-2">
        {choices.flatMap(entry =>
          entry.files.map(attachment => (
            <AttachmentPreviewItem
              key={attachment.id}
              attachment={attachment}
              disabled={disabled}
              onRetry={draftId => void transfer(entry, draftId)}
              onRemove={draftId =>
                useAttachmentStore.getState().removeFile(draftId, entry.scope)
              }
            />
          ))
        )}
      </div>
    ) : null,
    notice:
      enabled && (!ready || requirementsChanged) && !input.isLoading ? (
        <p
          role="alert"
          className="px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          {t(
            ready
              ? 'input.capabilitiesChanged'
              : capabilities?.status === 'unsupported'
                ? 'input.capabilitiesUnsupported'
                : 'input.capabilitiesUnavailable'
          )}{' '}
          <button
            type="button"
            className="underline"
            onClick={refreshCapabilities}
          >
            {tCommon('retry')}
          </button>
        </p>
      ) : uploadError && uploadError.scope === activeScope ? (
        <p
          role="alert"
          className="px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          {uploadError.message}
        </p>
      ) : null,
  };
}
