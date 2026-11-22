'use client';

import { AttachmentPreviewItem } from '@components/chat-input/attachment-preview-item';
import { ChatButton } from '@components/chat-input/button';
import { Popover } from '@components/ui/popover';
import { uploadDifyFile } from '@lib/services/dify/file-service';
import {
  type AttachmentFile,
  useAttachmentStore,
} from '@lib/stores/attachment-store';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { Paperclip } from 'lucide-react';

import { type ReactNode, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  type AgentAttachmentSlot,
  INPUT_FILE_EXTENSIONS,
  inputFileType,
  validateInputFile,
  validateInputFileCount,
} from '../../packages/shared/src/agent-input';
import type { UploadPayloadFile } from './chatflow-input-area/types';

interface ChatflowAttachmentsOptions {
  scope: string | null;
  instanceId: string;
  userId: string | undefined;
  slots: AgentAttachmentSlot[];
  disabled?: boolean;
  onRequirementsChanged?: () => void;
}

interface SlotDraft {
  slot: AgentAttachmentSlot;
  scope: string;
  entries: AttachmentFile[];
}

type Translate = (
  key: string,
  values?: Record<string, string | number>
) => string;

function validationMessage(
  code: string,
  slot: AgentAttachmentSlot,
  translate: Translate
) {
  switch (code) {
    case 'INPUT_FILES_REQUIRED':
      return translate('input.filesRequired');
    case 'INPUT_TOO_MANY_FILES':
      return translate('fileTypeSelector.maxFilesReached', {
        maxFiles: slot.maxCount,
      });
    case 'INPUT_FILE_TYPE':
      return translate('fileUpload.unsupportedFormat');
    case 'INPUT_FILE_SIZE':
      return translate('fileUpload.fileTooLarge');
    case 'INPUT_UPLOAD_DISABLED':
      return translate('input.localUploadUnavailable');
    default:
      return translate('input.capabilitiesUnavailable');
  }
}

function slotAccept(slot: AgentAttachmentSlot) {
  const extensions = slot.extensions.length
    ? slot.extensions
    : slot.allowedTypes.flatMap(type => INPUT_FILE_EXTENSIONS[type]);
  return [...new Set(extensions)].map(extension => `.${extension}`).join(',');
}

function slotLabel({ slot, entries }: SlotDraft) {
  return `${slot.label}${slot.minCount > 0 ? ' *' : ''} ${entries.length}/${slot.maxCount}`;
}

function AttachmentAction({
  drafts,
  disabled,
  onSelect,
}: {
  drafts: SlotDraft[];
  disabled: boolean;
  onSelect: (draft: SlotDraft, files: File[]) => void;
}) {
  const translate = useTranslations('pages.chat');
  const [open, setOpen] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const local = drafts.filter(draft =>
    draft.slot.methods.includes('local_file')
  );
  const available = (draft: SlotDraft) =>
    !disabled && draft.entries.length < draft.slot.maxCount;
  const choose = (draft: SlotDraft) => {
    if (!available(draft)) return;
    inputs.current[draft.scope]?.click();
    setOpen(false);
  };
  const trigger = (
    <ChatButton
      icon={<Paperclip className="h-4 w-4" />}
      ariaLabel={translate('fileTypeSelector.ariaLabel')}
      disabled={disabled || (local.length === 1 && !available(local[0]))}
      onClick={local.length === 1 ? () => choose(local[0]) : undefined}
    />
  );

  if (!local.length) {
    return (
      <span
        role="status"
        className="block max-w-40 font-serif text-xs break-words text-stone-500 sm:max-w-64"
      >
        {drafts.map(draft => draft.slot.label).join(', ')}:{' '}
        {translate('input.localUploadUnavailable')}
      </span>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      {drafts.map(draft => (
        <input
          key={draft.scope}
          ref={element => {
            inputs.current[draft.scope] = element;
          }}
          type="file"
          className="hidden"
          aria-label={draft.slot.label}
          accept={slotAccept(draft.slot)}
          multiple={draft.slot.maxCount > 1}
          disabled={
            !draft.slot.methods.includes('local_file') || !available(draft)
          }
          onChange={event => {
            const files = Array.from(event.currentTarget.files || []);
            event.currentTarget.value = '';
            if (available(draft)) onSelect(draft, files);
          }}
        />
      ))}
      {local.length === 1 ? (
        <>
          {trigger}
          <span
            className="max-w-28 truncate font-serif text-xs text-stone-500 sm:max-w-48"
            title={
              available(local[0])
                ? slotLabel(local[0])
                : translate('fileTypeSelector.maxFilesReached', {
                    maxFiles: local[0].slot.maxCount,
                  })
            }
          >
            {slotLabel(local[0])}
          </span>
        </>
      ) : (
        <Popover
          trigger={trigger}
          placement="top"
          isOpen={open && !disabled}
          onOpenChange={setOpen}
          offsetX={0}
          offsetY={0}
        >
          <div className="max-h-64 max-w-[calc(100vw-2rem)] overflow-y-auto px-1">
            {drafts.map(draft => (
              <button
                key={draft.scope}
                type="button"
                className="block w-full rounded-lg px-3 py-2 text-left font-serif text-sm hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-stone-600"
                disabled={
                  !draft.slot.methods.includes('local_file') ||
                  !available(draft)
                }
                onClick={() => choose(draft)}
              >
                <span className="block">{slotLabel(draft)}</span>
                {!draft.slot.methods.includes('local_file') ? (
                  <span className="block text-xs">
                    {translate('input.localUploadUnavailable')}
                  </span>
                ) : draft.entries.length >= draft.slot.maxCount ? (
                  <span className="block text-xs">
                    {translate('fileTypeSelector.maxFilesReached', {
                      maxFiles: draft.slot.maxCount,
                    })}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

export function useChatflowAttachments({
  scope,
  instanceId,
  userId,
  slots,
  disabled = false,
  onRequirementsChanged,
}: ChatflowAttachmentsOptions): {
  action: ReactNode;
  preview: ReactNode;
  inputs: Record<string, unknown>;
  files: UploadPayloadFile[];
  blocked: boolean;
  errors: string[];
  consume: () => void;
} {
  const translate = useTranslations('pages.chat');
  const store = useAttachmentStore();
  const actorEpoch = useChatInputStore(state => state.actorEpoch);
  const actorId = useChatInputStore(state => state.actorId);
  const [selectionErrors, setSelectionErrors] = useState<
    Record<string, string>
  >({});
  const isCurrentActor = () => {
    const actor = useChatInputStore.getState();
    return Boolean(
      userId && actor.actorId === userId && actor.actorEpoch === actorEpoch
    );
  };
  const enabled = Boolean(scope && instanceId && userId && actorId === userId);
  const resolvedScope = scope ? store.resolveScope(scope) : null;
  const draftScope = resolvedScope
    ? Object.keys(store.aliases).find(
        alias => store.resolveScope(alias) === resolvedScope
      ) || resolvedScope
    : null;
  const drafts: SlotDraft[] = slots.map(slot => {
    const boundedSlot =
      slot.target === 'inputs' && !(slot.multiple ?? slot.maxCount !== 1)
        ? { ...slot, maxCount: Math.min(1, slot.maxCount) }
        : slot;
    const bucket = JSON.stringify([
      'chatflow-attachments',
      userId,
      actorEpoch,
      instanceId,
      draftScope,
      slot.target,
      slot.key,
    ]);
    return {
      slot: boundedSlot,
      scope: bucket,
      entries: enabled ? store.getFiles(bucket) : [],
    };
  });
  const clearSelectionError = (draft: SlotDraft) => {
    setSelectionErrors(previous => {
      const next = { ...previous };
      delete next[draft.scope];
      return next;
    });
  };
  const upload = async (draft: SlotDraft, id: string) => {
    if (!enabled || disabled || !userId || !isCurrentActor()) return;
    const current = useAttachmentStore.getState();
    const entries = current.getFiles(draft.scope);
    const entry = entries.find(file => file.id === id);
    if (!entry || entry.status === 'uploading' || entry.status === 'success')
      return;
    const validationError =
      validateInputFile(draft.slot, entry.file) ||
      (entries.length > draft.slot.maxCount ? 'INPUT_TOO_MANY_FILES' : null);
    if (validationError) {
      setSelectionErrors(previous => ({
        ...previous,
        [draft.scope]: validationError,
      }));
      onRequirementsChanged?.();
      return;
    }
    const attempt = current.beginUpload(draft.scope, id);
    if (attempt === undefined) return;
    const isCurrentAttempt = () =>
      isCurrentActor() &&
      useAttachmentStore
        .getState()
        .getFiles(draft.scope)
        .some(file => file.id === id && file.uploadAttempt === attempt);
    try {
      const response = await uploadDifyFile(instanceId, entry.file, userId);
      if (!isCurrentAttempt()) return;
      useAttachmentStore.getState().finishUpload(draft.scope, id, attempt, {
        uploadedId: response.id,
        previewUrl: response.preview_url || response.source_url || undefined,
        appId: instanceId,
        actorId: userId,
        actorEpoch,
      });
    } catch (error) {
      if (!isCurrentAttempt()) return;
      useAttachmentStore.getState().finishUpload(draft.scope, id, attempt, {
        error:
          error instanceof Error
            ? error.message
            : translate('input.uploadFailed'),
      });
      onRequirementsChanged?.();
    }
  };
  const select = (draft: SlotDraft, files: File[]) => {
    if (!enabled || disabled || !files.length || !isCurrentActor()) return;
    const reservation = useAttachmentStore
      .getState()
      .reserveFiles(files, draft.slot, draft.scope);
    if (reservation.error) {
      setSelectionErrors(previous => ({
        ...previous,
        [draft.scope]: reservation.error as string,
      }));
      onRequirementsChanged?.();
      return;
    }
    clearSelectionError(draft);
    reservation.ids.forEach(id => void upload(draft, id));
  };
  const inputs: Record<string, unknown> = Object.create(null);
  const files: UploadPayloadFile[] = [];
  const errors: string[] = [];
  let blocked = false;
  for (const draft of drafts) {
    const { slot, entries } = draft;
    const validationError =
      validateInputFileCount(slot, entries.length) ||
      entries.map(entry => validateInputFile(slot, entry.file)).find(Boolean);
    const unfinished = entries.some(
      entry =>
        entry.status !== 'success' ||
        !entry.uploadedId ||
        entry.uploadedAppId !== instanceId ||
        entry.uploadedActorId !== userId ||
        entry.uploadedActorEpoch !== actorEpoch
    );
    if (validationError || unfinished) blocked = true;
    const draftErrors = [
      validationError && validationMessage(validationError, slot, translate),
      unfinished && translate('input.uploadPending'),
      selectionErrors[draft.scope] &&
        validationMessage(selectionErrors[draft.scope], slot, translate),
    ].filter((message): message is string => Boolean(message));
    errors.push(
      ...[...new Set(draftErrors)].map(message => `${slot.label}: ${message}`)
    );
    const payload: UploadPayloadFile[] = entries
      .filter(
        entry =>
          entry.status === 'success' &&
          entry.uploadedId &&
          entry.uploadedAppId === instanceId &&
          entry.uploadedActorId === userId &&
          entry.uploadedActorEpoch === actorEpoch
      )
      .map(entry => ({
        type: inputFileType(entry.name, entry.type),
        transfer_method: 'local_file',
        upload_file_id: entry.uploadedId,
        name: entry.name,
        size: entry.size,
        mime_type: entry.type,
        ...(entry.uploadedPreviewUrl
          ? { preview_url: entry.uploadedPreviewUrl }
          : {}),
        app_id: instanceId,
        actor_id: userId,
        actor_epoch: actorEpoch,
      }));
    if (slot.target === 'files') files.push(...payload);
    else if (payload.length)
      inputs[slot.key] =
        (slot.multiple ?? slot.maxCount !== 1) ? payload : payload[0];
  }

  const remoteLabels = drafts
    .filter(draft => !draft.slot.methods.includes('local_file'))
    .map(draft => draft.slot.label);
  const showRemoteNotice =
    remoteLabels.length > 0 && remoteLabels.length < drafts.length;

  return {
    action: drafts.length ? (
      <AttachmentAction
        key={JSON.stringify([userId, actorEpoch, instanceId, draftScope])}
        drafts={drafts}
        disabled={disabled || !enabled}
        onSelect={select}
      />
    ) : null,
    preview:
      drafts.some(draft => draft.entries.length) || showRemoteNotice ? (
        <div className="space-y-2 px-3 pt-3 pb-2">
          {showRemoteNotice && (
            <p role="status" className="font-serif text-xs text-stone-500">
              {remoteLabels.join(', ')}:{' '}
              {translate('input.localUploadUnavailable')}
            </p>
          )}
          {drafts
            .filter(draft => draft.entries.length)
            .map(draft => (
              <div key={draft.scope} role="group" aria-label={draft.slot.label}>
                <p className="mb-1 font-serif text-xs text-stone-500">
                  {slotLabel(draft)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {draft.entries.map(entry => (
                    <AttachmentPreviewItem
                      key={entry.id}
                      attachment={entry}
                      onRemove={id => {
                        if (disabled || !isCurrentActor()) return;
                        useAttachmentStore
                          .getState()
                          .removeFile(id, draft.scope);
                        clearSelectionError(draft);
                      }}
                      onRetry={id => {
                        clearSelectionError(draft);
                        void upload(draft, id);
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
        </div>
      ) : null,
    inputs,
    files,
    blocked,
    errors,
    consume: () => {
      if (!isCurrentActor()) return;
      drafts.forEach(draft => {
        useAttachmentStore.getState().consumeFiles(draft.scope, draft.entries);
        clearSelectionError(draft);
      });
    },
  };
}
