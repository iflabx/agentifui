'use client';

import { cn } from '@lib/utils';

import type { ComponentProps } from 'react';

export function ExecutionProcessPanel({
  className,
  ...props
}: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      data-execution-process-panel
      className={cn(
        'max-h-[calc(100dvh-12rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-lg border border-stone-200 bg-white/95 p-4 shadow-lg dark:border-stone-700 dark:bg-stone-800/95',
        className
      )}
    />
  );
}
