'use client';

import { useFilePreviewStore } from '@lib/stores/ui/file-preview-store';

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { ExecutionProcessPanel } from './panel';
import type { ExecutionProcessItem, ExecutionProcessStatus } from './types';
import { ExecutionProcessView } from './view';

interface ExecutionProcessDisclosureProps {
  items: ExecutionProcessItem[];
  completedCount?: number;
  historical?: boolean;
  unordered?: boolean;
  executing?: boolean;
  failed?: boolean;
  renderItem?: (item: ExecutionProcessItem, index: number) => ReactNode;
  placement?: 'inline' | 'panel';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  status?: ExecutionProcessStatus;
  suspended?: boolean;
  showEmpty?: boolean;
}

export function ExecutionProcessDisclosure({
  items,
  completedCount,
  historical,
  unordered,
  executing,
  failed,
  renderItem,
  placement = 'inline',
  open: controlledOpen,
  onOpenChange,
  title,
  status,
  suspended,
  showEmpty,
}: ExecutionProcessDisclosureProps) {
  const translate = useTranslations('executionProcess');
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const previewOpen = useFilePreviewStore(state => state.isPreviewOpen);
  const visible = open && !suspended && !(placement === 'panel' && previewOpen);
  const focusRequested = useRef(false);
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    onOpenChange?.(next);
  };
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const contentId = useId();
  useEffect(() => {
    if (visible && focusRequested.current && placement === 'panel')
      panel.current?.focus({ preventScroll: true });
    focusRequested.current = false;
  }, [visible, placement]);
  if (items.length === 0 && !executing && !showEmpty && !status) return null;
  const canOpen = items.length > 0 || executing || showEmpty;
  const Container = placement === 'panel' ? ExecutionProcessPanel : 'div';
  return (
    <div className="my-2">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-stone-600 dark:text-stone-300">
        {status && <span role="status">{translate(`status.${status}`)}</span>}
        {canOpen && (
          <button
            ref={trigger}
            type="button"
            aria-expanded={visible}
            aria-controls={visible ? contentId : undefined}
            disabled={Boolean(
              suspended || (placement === 'panel' && previewOpen)
            )}
            className="rounded underline underline-offset-4 focus-visible:outline-2"
            onClick={() => {
              focusRequested.current = !open;
              setOpen(!open);
            }}
          >
            {translate(visible ? 'hide' : 'view')}
          </button>
        )}
      </div>
      {visible && canOpen && (
        <Container
          ref={panel}
          tabIndex={-1}
          id={contentId}
          className={
            placement === 'panel'
              ? undefined
              : 'mt-2 max-h-[min(28rem,60dvh)] overflow-y-auto overscroll-contain rounded-lg border border-stone-200 p-3 dark:border-stone-700'
          }
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          {title && (
            <p className="mb-2 truncate text-xs text-stone-500" title={title}>
              {title}
            </p>
          )}
          <ExecutionProcessView
            items={items}
            completedCount={completedCount}
            historical={historical}
            unordered={unordered}
            executing={executing}
            failed={failed}
            renderItem={renderItem}
            onClose={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          />
        </Container>
      )}
    </div>
  );
}
