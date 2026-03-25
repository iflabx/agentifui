'use client';

import { CollapsibleContent } from '@components/chatflow/chatflow-execution-bar/collapsible-content';
import {
  formatDuration,
  getBarStyles,
  getCounterBadgeText,
  getNodeTitle,
  getStatusText,
  isExpandableNode,
  shouldShowExpandedParallelBranches,
} from '@components/chatflow/chatflow-execution-bar/helpers';
import { ParallelBranchItem } from '@components/chatflow/chatflow-execution-bar/parallel-branch-item';
import { ProgressBar } from '@components/chatflow/chatflow-execution-bar/progress-bar';
import type { ChatflowNode } from '@lib/stores/chatflow-execution-store';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import { cn } from '@lib/utils';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  XCircle,
} from 'lucide-react';

import React, { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

interface ChatflowExecutionBarProps {
  node: ChatflowNode;
  index: number;
  delay?: number;
}

export function ChatflowExecutionBar({
  node,
  index,
  delay = 0,
}: ChatflowExecutionBarProps) {
  const t = useTranslations('pages.chatflow.executionBar');
  const [isVisible, setIsVisible] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);

  const {
    iterationExpandedStates,
    loopExpandedStates,
    toggleIterationExpanded,
    toggleLoopExpanded,
  } = useChatflowExecutionStore();
  const isExpanded =
    (node.isIterationNode
      ? iterationExpandedStates[node.id]
      : node.isLoopNode
        ? loopExpandedStates[node.id]
        : false) || false;

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [delay]);

  useEffect(() => {
    if (node.status === 'running' && node.startTime) {
      const interval = setInterval(() => {
        setElapsedTime(Date.now() - node.startTime!);
      }, 100);

      return () => clearInterval(interval);
    }

    if (node.status === 'completed' && node.startTime && node.endTime) {
      setElapsedTime(node.endTime - node.startTime);
    }
  }, [node.endTime, node.startTime, node.status]);

  useEffect(() => {
    if (node.isIterationNode) {
      console.log('[ChatflowExecutionBar] Iteration node status updated:', {
        id: node.id,
        title: node.title,
        isIterationNode: node.isIterationNode,
        totalIterations: node.totalIterations,
        currentIteration: node.currentIteration,
        iterationsCount: node.iterations?.length || 0,
        status: node.status,
      });
    }
  }, [node]);

  const getStatusIcon = () => {
    switch (node.status) {
      case 'running':
        return (
          <Loader2
            className={cn(
              'h-4 w-4 animate-spin',
              'text-stone-600 dark:text-stone-400'
            )}
          />
        );
      case 'completed':
        return (
          <CheckCircle
            className={cn('h-4 w-4', 'text-stone-600 dark:text-stone-400')}
          />
        );
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'pending':
        return (
          <Clock
            className={cn('h-4 w-4', 'text-stone-400 dark:text-stone-500')}
          />
        );
      default:
        return (
          <AlertCircle
            className={cn('h-4 w-4', 'text-stone-400 dark:text-stone-500')}
          />
        );
    }
  };

  const counterBadgeText = getCounterBadgeText(node);

  return (
    <div className="space-y-1">
      <div
        className={cn(
          getBarStyles(node, isVisible),
          'transition-all duration-200 hover:scale-[1.02] hover:shadow-md',
          isExpandableNode(node) && 'cursor-pointer'
        )}
        onClick={
          isExpandableNode(node)
            ? () => {
                if (node.isIterationNode) {
                  toggleIterationExpanded(node.id);
                } else if (node.isLoopNode) {
                  toggleLoopExpanded(node.id);
                }
              }
            : undefined
        }
      >
        <div className="flex-shrink-0">{getStatusIcon()}</div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'flex-1 truncate font-serif text-sm font-medium',
                'text-stone-800 dark:text-stone-200'
              )}
            >
              {getNodeTitle(node, index, t)}
            </span>

            <div className="flex flex-shrink-0 items-center gap-1">
              {counterBadgeText && (
                <span
                  className={cn(
                    'rounded bg-stone-200 px-1.5 py-0.5 text-xs text-stone-700',
                    'dark:bg-stone-700/50 dark:text-stone-300'
                  )}
                >
                  {counterBadgeText}
                </span>
              )}

              <span
                className={cn(
                  'rounded px-1.5 py-0.5 font-serif text-xs transition-all duration-300',
                  node.status === 'running'
                    ? cn(
                        'animate-pulse',
                        'bg-stone-300/60 text-stone-700 dark:bg-stone-600/40 dark:text-stone-200'
                      )
                    : node.status === 'completed'
                      ? 'bg-stone-200 text-stone-800 dark:bg-stone-500/40 dark:text-stone-100'
                      : node.status === 'failed'
                        ? 'bg-red-100 text-red-700 dark:bg-red-700/30 dark:text-red-200'
                        : 'bg-stone-200/80 text-stone-600 dark:bg-stone-700/50 dark:text-stone-400'
                )}
              >
                {getStatusText(node, t)}
              </span>
            </div>
          </div>
        </div>

        <div className="w-12 flex-shrink-0 text-right">
          {(node.status === 'running' || node.status === 'completed') &&
            elapsedTime > 0 && (
              <div
                className={cn(
                  'font-serif text-xs',
                  'text-stone-500 dark:text-stone-400'
                )}
              >
                {formatDuration(elapsedTime)}
              </div>
            )}
        </div>
      </div>

      <CollapsibleContent
        isExpanded={isExpanded}
        show={shouldShowExpandedParallelBranches(node, isExpanded)}
      >
        <div className="ml-4 space-y-2">
          {node.totalBranches && (
            <div className="px-3 py-2">
              <ProgressBar
                current={node.completedBranches || 0}
                total={node.totalBranches}
                type="branch"
              />
            </div>
          )}

          <div className="space-y-1">
            {node.parallelBranches?.map(branch => (
              <ParallelBranchItem key={branch.id} branch={branch} />
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </div>
  );
}
