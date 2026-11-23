'use client';

import { Popover } from '@components/ui/popover';
import { Paperclip } from 'lucide-react';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  type AgentAttachmentSlot,
  INPUT_FILE_EXTENSIONS,
} from '../../packages/shared/src/agent-input';
import { ChatButton } from './button';

export interface AttachmentChoice {
  id: string;
  slot: AgentAttachmentSlot;
  count: number;
}

export function attachmentAccept(slot: AgentAttachmentSlot) {
  const extensions = slot.extensions.length
    ? slot.extensions
    : slot.allowedTypes.flatMap(type => INPUT_FILE_EXTENSIONS[type]);
  return [...new Set(extensions)].map(extension => `.${extension}`).join(',');
}

export function AttachmentAction({
  choices,
  disabled = false,
  onChoose,
  ariaLabel,
  status,
}: {
  choices: AttachmentChoice[];
  disabled?: boolean;
  onChoose: (choice: AttachmentChoice) => void;
  ariaLabel?: string;
  status?: 'loading' | 'unavailable';
}) {
  const translate = useTranslations('pages.chat');
  const [open, setOpen] = useState(false);
  const local = choices.filter(choice =>
    choice.slot.methods.includes('local_file')
  );
  const available = (choice: AttachmentChoice) =>
    !disabled && choice.count < choice.slot.maxCount;
  const canChoose = !status && local.some(available);
  const hintFor = (items: AttachmentChoice[]) => {
    const count = items.reduce((total, item) => total + item.count, 0);
    const minCount = items.reduce(
      (total, item) => total + item.slot.minCount,
      0
    );
    const maxCount = items.reduce(
      (total, item) => total + item.slot.maxCount,
      0
    );
    if (count > 0) {
      const selected = translate('fileTypeSelector.attachmentSelected', {
        count,
        maxCount,
      });
      const remaining = items.reduce(
        (total, item) => total + Math.max(0, item.slot.minCount - item.count),
        0
      );
      return remaining > 0
        ? `${selected} · ${translate('fileTypeSelector.attachmentRemaining', { count: remaining })}`
        : selected;
    }
    if (minCount > 0)
      return minCount === maxCount
        ? translate('fileTypeSelector.attachmentRequired', { count: minCount })
        : translate('fileTypeSelector.attachmentRange', { minCount, maxCount });
    return translate('fileTypeSelector.maxUpload', { maxFiles: maxCount });
  };
  const statusHint = status
    ? translate(
        status === 'loading'
          ? 'fileTypeSelector.loading'
          : 'fileTypeSelector.loadError'
      )
    : undefined;
  const hint = statusHint || (local.length ? hintFor(local) : undefined);
  const title =
    statusHint ||
    (local.length
      ? hint
      : translate(
          choices.length
            ? 'input.localUploadUnavailable'
            : 'fileTypeSelector.notSupported'
        ));
  const choose = (choice: AttachmentChoice) => {
    if (
      status ||
      !choice.slot.methods.includes('local_file') ||
      !available(choice)
    )
      return;
    onChoose(choice);
    setOpen(false);
  };
  const trigger = (
    <ChatButton
      icon={<Paperclip className="h-4 w-4" />}
      ariaLabel={ariaLabel || translate('fileTypeSelector.ariaLabel')}
      disabled={!canChoose}
      onClick={local.length === 1 ? () => choose(local[0]) : undefined}
    />
  );
  return (
    <div className="flex min-w-0 items-center gap-2">
      {local.length <= 1 ? (
        <span title={title}>{trigger}</span>
      ) : (
        <Popover
          trigger={<span title={title}>{trigger}</span>}
          placement="top"
          isOpen={open && canChoose}
          onOpenChange={value => setOpen(value && canChoose)}
          offsetX={0}
          offsetY={0}
        >
          <div className="max-h-64 max-w-[calc(100vw-2rem)] overflow-y-auto px-1">
            {choices.map(choice => (
              <button
                key={choice.id}
                type="button"
                className="block w-full rounded-lg px-3 py-2 text-left font-serif text-sm hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-stone-600"
                disabled={
                  !choice.slot.methods.includes('local_file') ||
                  !available(choice)
                }
                onClick={() => choose(choice)}
              >
                <span className="block break-words">{choice.slot.label}</span>
                <span className="block text-xs text-stone-500 dark:text-stone-400">
                  {choice.slot.methods.includes('local_file')
                    ? hintFor([choice])
                    : translate('input.localUploadUnavailable')}
                </span>
              </button>
            ))}
          </div>
        </Popover>
      )}
      {hint && (
        <span
          role="status"
          className="max-w-40 text-xs leading-relaxed break-words text-stone-500 sm:max-w-64 dark:text-stone-400"
        >
          {hint}
        </span>
      )}
    </div>
  );
}
