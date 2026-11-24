'use client';

import {
  difyProcessItem,
  visibleDifyNodes,
} from '@components/execution-process/adapters';
import { ExecutionProcessDisclosure } from '@components/execution-process/disclosure';
import type { ExecutionProcessStatus } from '@components/execution-process/types';
import type { ChatflowNode } from '@lib/stores/chatflow-execution-store';

import { useState } from 'react';

import { ChatflowExecutionBar } from './chatflow-execution-bar';

interface ChatflowNodeTrackerProps {
  nodes: ChatflowNode[];
  scope: string;
  status: ExecutionProcessStatus;
  historical?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChatflowNodeTracker({
  nodes,
  scope,
  status,
  historical,
  open,
  onOpenChange,
}: ChatflowNodeTrackerProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const visibleNodes = visibleDifyNodes(nodes, expanded, expanded);
  return (
    <ExecutionProcessDisclosure
      placement="panel"
      items={visibleNodes.map(node => difyProcessItem(node, scope))}
      completedCount={nodes.filter(node => node.status === 'completed').length}
      executing={status === 'running'}
      failed={status === 'failed'}
      historical={historical}
      status={status}
      open={open}
      onOpenChange={onOpenChange}
      renderItem={(item, index) => {
        const node = visibleNodes[index];
        return (
          <ChatflowExecutionBar
            item={item}
            node={node}
            index={index}
            expanded={Boolean(expanded[node.id])}
            onToggle={() =>
              setExpanded(previous => ({
                ...previous,
                [node.id]: !previous[node.id],
              }))
            }
          />
        );
      }}
    />
  );
}
