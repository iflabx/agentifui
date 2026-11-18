'use client';

import { useId, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import type { ExecutionProcessItem } from './types';
import { ExecutionProcessView } from './view';

interface ExecutionProcessDisclosureProps {
  items: ExecutionProcessItem[];
  historical?: boolean;
  unordered?: boolean;
}

export function ExecutionProcessDisclosure({
  items,
  historical,
  unordered,
}: ExecutionProcessDisclosureProps) {
  const translate = useTranslations('executionProcess');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const contentId = useId();
  if (items.length === 0) return null;
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
        <div
          id={contentId}
          className="mt-2 max-h-[min(28rem,60dvh)] overflow-y-auto overscroll-contain rounded-lg border border-stone-200 p-3 dark:border-stone-700"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          <ExecutionProcessView
            items={items}
            historical={historical}
            unordered={unordered}
            onClose={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          />
        </div>
      )}
    </div>
  );
}
