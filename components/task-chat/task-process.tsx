'use client';

import {
  difyProcessItem,
  visibleDifyNodes,
  workflowSnapshotItems,
} from '@components/execution-process/adapters';
import { ExecutionProcessDisclosure } from '@components/execution-process/disclosure';
import { ExecutionBar } from '@components/workflow/workflow-tracker/execution-bar';
import {
  type WorkflowNode,
  useWorkflowExecutionStore,
} from '@lib/stores/workflow-execution-store';
import type { AppExecution } from '@lib/types/database';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

export function savedTaskNodes(
  metadata: Record<string, unknown>
): WorkflowNode[] {
  const nodes = metadata.task_process_nodes;
  if (!Array.isArray(nodes)) return [];
  const valid = nodes.every(
    node =>
      node &&
      typeof node === 'object' &&
      typeof node.id === 'string' &&
      typeof node.title === 'string' &&
      typeof node.description === 'string' &&
      ['pending', 'running', 'completed', 'failed'].includes(node.status) &&
      ['iterations', 'loops', 'parallelBranches'].every(
        key =>
          node[key] === undefined ||
          (Array.isArray(node[key]) &&
            node[key].every(
              (entry: unknown) =>
                entry &&
                typeof entry === 'object' &&
                'id' in entry &&
                typeof entry.id === 'string' &&
                'status' in entry &&
                typeof entry.status === 'string'
            ))
      )
  );
  return valid ? (nodes as WorkflowNode[]) : [];
}

export function TaskProcess({
  execution,
  live,
}: {
  execution: AppExecution;
  live: boolean;
}) {
  const t = useTranslations('taskChat');
  const current = useWorkflowExecutionStore(state => state.nodes);
  const liveIteration = useWorkflowExecutionStore(
    state => state.iterationExpandedStates
  );
  const liveLoop = useWorkflowExecutionStore(state => state.loopExpandedStates);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const nodes = live ? current : savedTaskNodes(execution.metadata);
  const visible = visibleDifyNodes(
    nodes,
    live ? liveIteration : expanded,
    live ? liveLoop : expanded
  );
  const items = nodes.length
    ? visible.map(node =>
        difyProcessItem(
          {
            ...node,
            status:
              !live && ['pending', 'running'].includes(node.status)
                ? 'unknown'
                : node.status,
          },
          execution.id
        )
      )
    : workflowSnapshotItems(execution.metadata, execution.id);
  if (!items.length)
    return live ? null : (
      <p className="mb-2 text-xs text-stone-500">{t('noProcess')}</p>
    );
  return (
    <ExecutionProcessDisclosure
      items={items}
      historical={!live}
      executing={live}
      renderItem={
        nodes.length
          ? (item, index) => (
              <ExecutionBar
                historical={!live}
                node={visible[index]}
                item={item}
                index={index}
                expansion={
                  live
                    ? undefined
                    : {
                        expanded: Boolean(expanded[visible[index].id]),
                        toggle: () =>
                          setExpanded(previous => ({
                            ...previous,
                            [visible[index].id]: !previous[visible[index].id],
                          })),
                      }
                }
              />
            )
          : undefined
      }
    />
  );
}
