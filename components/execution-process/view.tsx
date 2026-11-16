'use client';

import { cn } from '@lib/utils';
import { X } from 'lucide-react';

import type { ReactNode } from 'react';

import { useTranslations } from 'next-intl';

import { ExecutionProcessRow } from './row';
import type { ExecutionProcessItem } from './types';

interface ExecutionProcessViewProps {
  items: ExecutionProcessItem[];
  completedCount?: number;
  executing?: boolean;
  historical?: boolean;
  unordered?: boolean;
  failed?: boolean;
  onClose?: () => void;
  renderItem?: (item: ExecutionProcessItem, index: number) => ReactNode;
  className?: string;
}

export function ExecutionProcessView({
  items,
  completedCount = items.filter(item => item.status === 'completed').length,
  executing = false,
  historical = false,
  unordered = false,
  failed = false,
  onClose,
  renderItem,
  className,
}: ExecutionProcessViewProps) {
  const translate = useTranslations('executionProcess');
  return (
    <section
      aria-label={translate('title')}
      onKeyDown={
        onClose
          ? event => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
              }
            }
          : undefined
      }
      className={cn(
        'min-w-0 space-y-3 font-serif text-stone-800 dark:text-stone-200',
        className
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{translate('title')}</h3>
        {onClose && (
          <button
            type="button"
            aria-label={translate('close')}
            onClick={onClose}
            className="shrink-0 rounded p-2 hover:bg-stone-100 focus-visible:outline-2 dark:hover:bg-stone-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </header>
      {historical && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {translate('historical')}
        </p>
      )}
      {unordered && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {translate('unordered')}
        </p>
      )}
      {items.length > 0 ? (
        <>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {translate('completedCount', {
              count: completedCount,
            })}
          </p>
          <ol className="space-y-2">
            {items.map((item, index) => (
              <li key={item.key}>
                {renderItem ? (
                  renderItem(item, index)
                ) : (
                  <ExecutionProcessRow item={item} />
                )}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p
          role="status"
          className="rounded-md border border-dashed border-stone-300 p-4 text-sm dark:border-stone-600"
        >
          {translate(executing && !historical ? 'waiting' : 'empty')}
        </p>
      )}
      {failed && (
        <p role="status" className="text-sm text-red-700 dark:text-red-300">
          {translate('failedNotice')}
        </p>
      )}
    </section>
  );
}
