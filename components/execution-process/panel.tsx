'use client';

import { cn } from '@lib/utils';
import { createPortal } from 'react-dom';

import type { ComponentProps } from 'react';

export function ExecutionProcessPanel({
  className,
  ...props
}: ComponentProps<'div'>) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      {...props}
      data-execution-process-panel
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 max-h-[65dvh] overflow-y-auto overscroll-contain rounded-t-lg border border-stone-200 bg-white p-4 shadow-lg md:inset-x-auto md:right-4 md:bottom-40 md:max-h-[calc(100dvh-12rem)] md:w-96 md:rounded-lg dark:border-stone-700 dark:bg-stone-800',
        className
      )}
    />,
    document.body
  );
}
