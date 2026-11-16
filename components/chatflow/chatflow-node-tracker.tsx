'use client';

import {
  difyProcessItem,
  visibleDifyNodes,
} from '@components/execution-process/adapters';
import { ExecutionProcessView } from '@components/execution-process/view';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import { cn } from '@lib/utils';

import { ChatflowExecutionBar } from './chatflow-execution-bar';

interface ChatflowNodeTrackerProps {
  isVisible: boolean;
  scope: string;
  onClose: () => void;
  className?: string;
}

export function ChatflowNodeTracker({
  isVisible,
  scope,
  onClose,
  className,
}: ChatflowNodeTrackerProps) {
  const nodes = useChatflowExecutionStore(state => state.nodes);
  const isExecuting = useChatflowExecutionStore(state => state.isExecuting);
  const error = useChatflowExecutionStore(state => state.error);
  const iterationExpandedStates = useChatflowExecutionStore(
    state => state.iterationExpandedStates
  );
  const loopExpandedStates = useChatflowExecutionStore(
    state => state.loopExpandedStates
  );
  const visibleNodes = visibleDifyNodes(
    nodes,
    iterationExpandedStates,
    loopExpandedStates
  );
  if (!isVisible) return null;
  return (
    <div
      className={cn(
        'max-h-[calc(100dvh-12rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-lg border border-stone-200 bg-white/95 p-4 shadow-lg dark:border-stone-700 dark:bg-stone-800/95',
        className
      )}
    >
      <ExecutionProcessView
        items={visibleNodes.map(node => difyProcessItem(node, scope))}
        completedCount={
          nodes.filter(node => node.status === 'completed').length
        }
        executing={isExecuting}
        failed={Boolean(error)}
        onClose={onClose}
        renderItem={(item, index) => (
          <ChatflowExecutionBar
            item={item}
            node={visibleNodes[index]}
            index={index}
          />
        )}
      />
    </div>
  );
}
