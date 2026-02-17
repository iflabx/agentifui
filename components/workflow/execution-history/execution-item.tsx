'use client';

import {
  DateFormatPresets,
  useDateFormatter,
} from '@lib/hooks/use-date-formatter';
import type { AppExecution } from '@lib/types/database';
import { cn } from '@lib/utils';
import {
  Check,
  CheckCircle,
  ChevronRight,
  Clock,
  Loader2,
  XCircle,
} from 'lucide-react';

import React from 'react';

import { useTranslations } from 'next-intl';

interface ExecutionItemProps {
  execution: AppExecution;
  onClick: () => void;
  isMultiSelectMode?: boolean;
  isSelected?: boolean;
  isLoading?: boolean;
}

/**
 * Single execution record item component
 *
 * Display the basic information and status of the execution record
 */
export function ExecutionItem({
  execution,
  onClick,
  isMultiSelectMode,
  isSelected,
  isLoading,
}: ExecutionItemProps) {
  const t = useTranslations('pages.workflow.status');
  const { formatDate } = useDateFormatter();

  const getStatusIcon = () => {
    switch (execution.status) {
      case 'completed':
        return (
          <CheckCircle className="h-3.5 w-3.5 text-stone-600 dark:text-stone-400" />
        );
      case 'failed':
        return <XCircle className="h-3.5 w-3.5 text-red-500" />;
      case 'running':
        return (
          <Clock className="h-3.5 w-3.5 animate-pulse text-stone-600 dark:text-stone-400" />
        );
      default:
        return (
          <Clock className="h-3.5 w-3.5 text-stone-600 dark:text-stone-400" />
        );
    }
  };

  const getStatusText = () => {
    switch (execution.status) {
      case 'completed':
        return t('completed');
      case 'failed':
        return t('failed');
      case 'running':
        return t('running');
      default:
        return t('unknown');
    }
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-md border p-3 transition-all duration-200',
        'hover:scale-[1.01] hover:shadow-md',
        // Selected state style
        isMultiSelectMode &&
          isSelected &&
          'border-stone-400 bg-stone-300/50 dark:border-stone-500 dark:bg-stone-600/50',
        // Default style
        (!isMultiSelectMode || !isSelected) &&
          'border-stone-300/50 bg-stone-50/50 hover:border-stone-400/50 hover:bg-stone-200/50 dark:border-stone-700/50 dark:bg-stone-700/30 dark:hover:border-stone-600/50 dark:hover:bg-stone-700/50'
      )}
    >
      <div className="flex items-center justify-between">
        {/* Checkbox in multi-select mode */}
        {isMultiSelectMode && (
          <div
            className={cn(
              'mr-3 flex h-4 w-4 items-center justify-center rounded border',
              isSelected
                ? 'border-stone-600 bg-stone-600 dark:border-stone-500 dark:bg-stone-500'
                : 'border-stone-300 dark:border-stone-600'
            )}
          >
            {isSelected && <Check className="h-3 w-3 text-white" />}
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Title and status */}
          <div className="mb-1.5 flex items-center gap-2">
            {getStatusIcon()}
            <h3 className="truncate font-serif text-sm font-medium text-stone-900 dark:text-gray-100">
              {execution.title}
            </h3>
          </div>

          {/* Time and duration */}
          <div className="flex items-center gap-3 font-serif text-xs">
            <span className="text-stone-500">
              {formatDate(execution.created_at, DateFormatPresets.dateTime)}
            </span>

            {execution.elapsed_time && (
              <span className="text-stone-500">{execution.elapsed_time}s</span>
            )}
          </div>

          {/* Error information */}
          {execution.status === 'failed' && execution.error_message && (
            <div className="mt-1.5 truncate font-serif text-xs text-red-500">
              {execution.error_message}
            </div>
          )}
        </div>

        {/* Status label */}
        <div className="ml-3 flex items-center gap-2">
          <span
            className={cn(
              'rounded-sm px-2 py-0.5 font-serif text-xs',
              execution.status === 'completed' &&
                'bg-stone-200/50 text-stone-700 dark:bg-stone-700/50 dark:text-stone-300',
              execution.status === 'failed' &&
                'bg-red-100/50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
              execution.status === 'running' &&
                'bg-stone-300/50 text-stone-700 dark:bg-stone-600/50 dark:text-stone-300'
            )}
          >
            {getStatusText()}
          </span>

          {/* Only show arrow or loading in non-multi-select mode */}
          {!isMultiSelectMode &&
            (isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-stone-400 dark:text-stone-500" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" />
            ))}
        </div>
      </div>
    </div>
  );
}
