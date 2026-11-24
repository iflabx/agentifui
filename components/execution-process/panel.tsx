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
        'fixed right-4 bottom-40 z-30 max-h-[calc(100dvh-12rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-lg border border-stone-200 bg-white/95 p-4 shadow-lg dark:border-stone-700 dark:bg-stone-800/95',
        className
      )}
    />,
    document.body
  );
}
