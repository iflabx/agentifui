'use client';

import type { ChatflowParallelBranch } from '@lib/stores/chatflow-execution-store';
import { cn } from '@lib/utils';
import { CheckCircle, Clock, GitBranch, Loader2, XCircle } from 'lucide-react';

import React, { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import { formatDuration, getParallelBranchLabel } from './helpers';

type ParallelBranchItemProps = {
  branch: ChatflowParallelBranch;
};

export function ParallelBranchItem({ branch }: ParallelBranchItemProps) {
  const t = useTranslations('pages.chatflow.executionBar');
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (branch.status === 'running' && branch.startTime) {
      const interval = setInterval(() => {
        setElapsedTime(Date.now() - branch.startTime);
      }, 100);
      return () => clearInterval(interval);
    }

    if (branch.status === 'completed' && branch.startTime && branch.endTime) {
      setElapsedTime(branch.endTime - branch.startTime);
    }
  }, [branch.endTime, branch.startTime, branch.status]);

  const getBranchIcon = () => {
    switch (branch.status) {
      case 'running':
        return <Loader2 className="h-3 w-3 animate-spin text-stone-500" />;
      case 'completed':
        return <CheckCircle className="h-3 w-3 text-stone-600" />;
      case 'failed':
        return <XCircle className="h-3 w-3 text-red-500" />;
      default:
        return <Clock className="h-3 w-3 text-stone-400" />;
    }
  };

  return (
    <div
      className={cn(
        'ml-4 flex items-center gap-2 rounded-md border-l-2 px-3 py-2 font-serif',
        branch.status === 'running' &&
          cn('border-l-stone-400', 'bg-stone-100 dark:bg-stone-800/20'),
        branch.status === 'completed' &&
          cn('border-l-stone-500', 'bg-stone-50 dark:bg-stone-700/20'),
        branch.status === 'failed' &&
          cn('border-l-red-500', 'bg-red-50 dark:bg-red-900/20'),
        branch.status === 'pending' &&
          cn('border-l-stone-300', 'bg-stone-50 dark:bg-stone-800/20')
      )}
    >
      <div className="flex-shrink-0">
        <GitBranch className="mr-1 h-3 w-3" />
        {getBranchIcon()}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-sm font-medium',
              'text-stone-800 dark:text-stone-200'
            )}
          >
            {t('branch.label')} {getParallelBranchLabel(branch.index)}
          </span>
          <span className={cn('text-xs', 'text-stone-600 dark:text-stone-400')}>
            {branch.description || t('status.executing_')}
          </span>
        </div>
      </div>

      <div className="w-12 flex-shrink-0 text-right">
        {elapsedTime > 0 && (
          <span
            className={cn(
              'font-serif text-xs',
              'text-stone-500 dark:text-stone-400'
            )}
          >
            {formatDuration(elapsedTime)}
          </span>
        )}
      </div>
    </div>
  );
}
