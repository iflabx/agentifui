'use client';

import {
  getCounterBadgeText,
  getNodeTitle,
  getParallelBranchLabel,
  isExpandableNode,
} from '@components/chatflow/chatflow-execution-bar/helpers';
import { difyProcessItem } from '@components/execution-process/adapters';
import { ExecutionProcessRow } from '@components/execution-process/row';
import type { ExecutionProcessItem } from '@components/execution-process/types';
import type { ChatflowNode } from '@lib/stores/chatflow-execution-store';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';

import { useTranslations } from 'next-intl';

interface ChatflowExecutionBarProps {
  node: ChatflowNode;
  index: number;
  item: ExecutionProcessItem;
}

export function ChatflowExecutionBar({
  node,
  index,
  item,
}: ChatflowExecutionBarProps) {
  const translate = useTranslations('pages.chatflow.executionBar');
  const iterationExpanded = useChatflowExecutionStore(
    state => state.iterationExpandedStates[node.id]
  );
  const loopExpanded = useChatflowExecutionStore(
    state => state.loopExpandedStates[node.id]
  );
  const toggleIterationExpanded = useChatflowExecutionStore(
    state => state.toggleIterationExpanded
  );
  const toggleLoopExpanded = useChatflowExecutionStore(
    state => state.toggleLoopExpanded
  );
  const children = node.isIterationNode
    ? node.iterations?.map(iteration =>
        difyProcessItem(
          {
            ...iteration,
            title: `${translate('nodeTypes.iteration')} ${iteration.index + 1}`,
          },
          item.key
        )
      )
    : node.isLoopNode
      ? node.loops?.map(loop =>
          difyProcessItem(
            {
              ...loop,
              title: `${translate('nodeTypes.iteration')} ${loop.index + 1}`,
            },
            item.key
          )
        )
      : node.isParallelNode
        ? node.parallelBranches?.map(branch =>
            difyProcessItem(
              {
                ...branch,
                title: `${translate('branch.label')} ${getParallelBranchLabel(branch.index)}`,
              },
              item.key
            )
          )
        : undefined;
  return (
    <ExecutionProcessRow
      item={{ ...item, title: getNodeTitle(node, index, translate), children }}
      className={
        node.isInIteration || node.isInLoop ? 'ml-4 w-auto' : undefined
      }
      badge={getCounterBadgeText(node)}
      expanded={Boolean(node.isLoopNode ? loopExpanded : iterationExpanded)}
      onToggle={
        isExpandableNode(node)
          ? () => {
              if (node.isLoopNode) toggleLoopExpanded(node.id);
              else toggleIterationExpanded(node.id);
            }
          : undefined
      }
    />
  );
}
