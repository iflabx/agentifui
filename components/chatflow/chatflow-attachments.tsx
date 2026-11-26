'use client';

import {
  AttachmentAction as SharedAttachmentAction,
  attachmentAccept,
} from '@components/chat-input/attachment-action';
import { AttachmentPreviewItem } from '@components/chat-input/attachment-preview-item';
import { uploadDifyFile } from '@lib/services/dify/file-service';
import {
  type AttachmentFile,
  useAttachmentStore,
} from '@lib/stores/attachment-store';
import { useChatInputStore } from '@lib/stores/chat-input-store';

import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useTranslations } from 'next-intl';

import {
  type AgentAttachmentSlot,
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
  authLoading?: boolean;
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

function AttachmentAction({
  drafts,
  disabled,
  onSelect,
}: {
  drafts: SlotDraft[];
  disabled: boolean;
  onSelect: (draft: SlotDraft, files: File[]) => void;
}) {
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const available = (draft: SlotDraft) =>
    !disabled && draft.entries.length < draft.slot.maxCount;
  return (
    <>
      {drafts.map(draft => (
        <input
          key={draft.scope}
          ref={element => {
            inputs.current[draft.scope] = element;
          }}
          type="file"
          className="hidden"
          aria-label={draft.slot.label}
          accept={attachmentAccept(draft.slot)}
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
      <SharedAttachmentAction
        choices={drafts.map(draft => ({
          id: draft.scope,
          slot: draft.slot,
          count: draft.entries.length,
        }))}
        disabled={disabled}
        onChoose={choice => inputs.current[choice.id]?.click()}
      />
    </>
  );
}

export function useChatflowAttachments({
  scope,
  instanceId,
  userId,
  slots,
  disabled = false,
  authLoading = false,
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
  useLayoutEffect(() => {
    if (enabled)
      for (const draft of drafts)
        useAttachmentStore.getState().restoreFiles(draft.scope);
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
    if (
      !entry?.file ||
      entry.status === 'uploading' ||
      entry.status === 'success'
    )
      return;
    const validationError =
      validateInputFile(draft.slot, entry.file) ||
      (entries.length > draft.slot.maxCount ? 'INPUT_TOO_MANY_FILES' : null);
    if (validationError) {
      current.setFiles(
        entries.map(file =>
          file.id === id
            ? {
                ...file,
                status: 'error',
                error: validationMessage(
                  validationError,
                  draft.slot,
                  translate
                ),
              }
            : file
        ),
        draft.scope
      );
      setSelectionErrors(previous =>
        previous[draft.scope] === validationError
          ? previous
          : { ...previous, [draft.scope]: validationError }
      );
      onRequirementsChanged?.();
      return;
    }
    if (authLoading) {
      if (entry.status === 'error')
        current.setFiles(
          entries.map(file =>
            file.id === id
              ? { ...file, status: 'pending', error: undefined }
              : file
          ),
          draft.scope
        );
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
  useEffect(() => {
    if (!enabled || disabled || authLoading || !isCurrentActor()) return;
    drafts.forEach(draft => {
      draft.entries.forEach(entry => {
        if (entry.status === 'pending') void upload(draft, entry.id);
      });
    });
  });
  const inputs: Record<string, unknown> = Object.create(null);
  const files: UploadPayloadFile[] = [];
  const errors: string[] = [];
  let blocked = false;
  for (const draft of drafts) {
    const { slot, entries } = draft;
    const validationError =
      validateInputFileCount(slot, entries.length) ||
      entries
        .map(entry => validateInputFile(slot, entry.file ?? entry))
        .find(Boolean);
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
      validationError &&
        (validationError !== 'INPUT_FILES_REQUIRED' ||
          !slot.methods.includes('local_file')) &&
        validationMessage(validationError, slot, translate),
      unfinished && translate('input.uploadPending'),
      selectionErrors[draft.scope] &&
        validationMessage(selectionErrors[draft.scope], slot, translate),
    ].filter((message): message is string => Boolean(message));
    errors.push(
      ...[...new Set(draftErrors)].map(message =>
        drafts.length > 1 ? `${slot.label}: ${message}` : message
      )
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

  return {
    action: (
      <AttachmentAction
        key={JSON.stringify([userId, actorEpoch, instanceId, draftScope])}
        drafts={drafts}
        disabled={disabled || !enabled}
        onSelect={select}
      />
    ),
    preview: drafts.some(draft => draft.entries.length) ? (
      <div className="space-y-2 px-3 pt-3 pb-2">
        {drafts
          .filter(draft => draft.entries.length)
          .map(draft => (
            <div key={draft.scope} role="group" aria-label={draft.slot.label}>
              {drafts.length > 1 && (
                <p className="mb-1 text-xs break-words text-stone-500 dark:text-stone-400">
                  {draft.slot.label}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {draft.entries.map(entry => (
                  <AttachmentPreviewItem
                    key={entry.id}
                    attachment={entry}
                    onRemove={id => {
                      if (disabled || !isCurrentActor()) return;
                      useAttachmentStore.getState().removeFile(id, draft.scope);
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
