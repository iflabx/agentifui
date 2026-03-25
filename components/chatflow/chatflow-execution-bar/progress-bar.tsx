'use client';

import { cn } from '@lib/utils';

import React from 'react';

import { useTranslations } from 'next-intl';

type ProgressBarProps = {
  current: number;
  total: number;
  type: 'iteration' | 'branch';
};

export function ProgressBar({ current, total, type }: ProgressBarProps) {
  const t = useTranslations('pages.chatflow.executionBar');
  const percentage = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between">
        <span
          className={cn(
            'font-serif text-xs font-medium',
            'text-stone-700 dark:text-stone-300'
          )}
        >
          {type === 'iteration'
            ? t('progressType.iteration')
            : t('progressType.branch')}
        </span>
        <span
          className={cn(
            'font-serif text-xs',
            'text-stone-500 dark:text-stone-400'
          )}
        >
          {current}/{total}
        </span>
      </div>

      <div
        className={cn(
          'h-2 w-full overflow-hidden rounded-full',
          'bg-stone-200 dark:bg-stone-700'
        )}
      >
        <div
          className={cn(
            'chatflow-progress-bar h-full rounded-full transition-all duration-500 ease-out',
            'bg-gradient-to-r from-stone-400 to-stone-500'
          )}
          style={
            {
              width: `${percentage}%`,
              '--progress-width': `${percentage}%`,
            } as React.CSSProperties
          }
        />
      </div>
    </div>
  );
}
