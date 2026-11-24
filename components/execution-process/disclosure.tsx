'use client';

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { ExecutionProcessPanel } from './panel';
import type { ExecutionProcessItem } from './types';
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
}: ExecutionProcessDisclosureProps) {
  const translate = useTranslations('executionProcess');
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    onOpenChange?.(next);
  };
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const contentId = useId();
  useEffect(() => {
    if (open && placement === 'panel')
      panel.current?.focus({ preventScroll: true });
  }, [open, placement]);
  if (items.length === 0 && !executing) return null;
  const Container = placement === 'panel' ? ExecutionProcessPanel : 'div';
  return (
    <div className="my-2">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        className="rounded text-xs underline underline-offset-4 focus-visible:outline-2"
        onClick={() => setOpen(!open)}
      >
        {translate(open ? 'hide' : 'view')}
      </button>
      {open && (
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
