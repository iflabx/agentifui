'use client';

import { cn } from '@lib/utils';
import {
  CheckCircle,
  ChevronRight,
  CircleHelp,
  Clock,
  Loader2,
  Square,
  XCircle,
} from 'lucide-react';

import { useId } from 'react';

import { useTranslations } from 'next-intl';

import type { ExecutionProcessItem } from './types';

interface ExecutionProcessRowProps {
  item: ExecutionProcessItem;
  expanded?: boolean;
  onToggle?: () => void;
  badge?: string | null;
  className?: string;
}

export function ExecutionProcessRow({
  item,
  expanded,
  onToggle,
  badge,
  className,
}: ExecutionProcessRowProps) {
  const translate = useTranslations('executionProcess');
  const contentId = useId();
  const Icon = {
    running: Loader2,
    completed: CheckCircle,
    failed: XCircle,
    pending: Clock,
    stopped: Square,
    unknown: CircleHelp,
  }[item.status];
  const content = (
    <>
      <Icon
        aria-hidden="true"
        className={cn(
          'h-4 w-4 shrink-0',
          item.status === 'running' && 'animate-spin motion-reduce:animate-none'
        )}
      />
      <span className="min-w-0 grow basis-24 text-left font-medium break-words">
        {item.title || translate(item.kind)}
      </span>
      {badge && <span className="shrink-0 text-xs">{badge}</span>}
      <span className="shrink-0 text-xs">
        {translate(`status.${item.status}`)}
      </span>
      {item.durationMs !== undefined &&
        Number.isFinite(item.durationMs) &&
        item.durationMs >= 0 && (
          <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">
            {translate('duration', {
              seconds: (item.durationMs / 1000).toFixed(1),
            })}
          </span>
        )}
      {onToggle && (
        <ChevronRight
          aria-hidden="true"
          className={cn('h-4 w-4 shrink-0', expanded && 'rotate-90')}
        />
      )}
    </>
  );
  const styles = cn(
    'flex w-full flex-wrap items-center gap-2 rounded-md border px-3 py-2 font-serif text-sm',
    'border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-200',
    item.status === 'failed' &&
      'border-red-200 text-red-700 dark:border-red-800 dark:text-red-300',
    className
  );
  return (
    <div>
      {onToggle ? (
        <button
          type="button"
          className={cn(
            styles,
            'focus-visible:outline-2 focus-visible:outline-offset-2'
          )}
          onClick={onToggle}
          aria-expanded={Boolean(expanded)}
          aria-controls={item.children && expanded ? contentId : undefined}
        >
          {content}
        </button>
      ) : (
        <div className={styles}>{content}</div>
      )}
      {item.children && (!onToggle || expanded) && (
        <div id={contentId} className="mt-2 ml-4 space-y-2">
          {item.children.map(child => (
            <ExecutionProcessRow key={child.key} item={child} />
          ))}
        </div>
      )}
    </div>
  );
}
