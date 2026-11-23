'use client';

import {
  difyProcessItem,
  visibleDifyNodes,
} from '@components/execution-process/adapters';
import { ExecutionProcessPanel } from '@components/execution-process/panel';
import { ExecutionProcessView } from '@components/execution-process/view';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';

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
    <ExecutionProcessPanel className={className}>
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
    </ExecutionProcessPanel>
  );
}
