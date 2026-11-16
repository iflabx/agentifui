import type { AgentToolSummary } from '@components/langchain/state';

import type { ExecutionProcessItem, ExecutionProcessStatus } from './types';

interface DifyNodeVisibility {
  id: string;
  isIterationNode?: boolean;
  isLoopNode?: boolean;
  isParallelNode?: boolean;
  isInIteration?: boolean;
  isInLoop?: boolean;
}

export function visibleDifyNodes<Node extends DifyNodeVisibility>(
  nodes: Node[],
  iterationExpanded: Record<string, boolean>,
  loopExpanded: Record<string, boolean>
): Node[] {
  return nodes.filter((node, index) => {
    if (node.isIterationNode || node.isLoopNode || node.isParallelNode)
      return true;
    if (!node.isInIteration && !node.isInLoop) return true;
    const container = nodes
      .slice(0, index)
      .find(candidate =>
        node.isInIteration ? candidate.isIterationNode : candidate.isLoopNode
      );
    return Boolean(
      container &&
      (node.isInIteration ? iterationExpanded : loopExpanded)[container.id]
    );
  });
}

export function processStatus(value: unknown): ExecutionProcessStatus {
  switch (value) {
    case 'pending':
    case 'running':
    case 'completed':
    case 'failed':
    case 'stopped':
      return value;
    case 'succeeded':
      return 'completed';
    default:
      return 'unknown';
  }
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function difyProcessItem(
  node: {
    id: string;
    title: string;
    status: string;
    startTime?: number;
    endTime?: number;
  },
  scope: string
): ExecutionProcessItem {
  const durationMs =
    finiteNonnegative(node.startTime) &&
    finiteNonnegative(node.endTime) &&
    node.endTime >= node.startTime
      ? node.endTime - node.startTime
      : undefined;
  return {
    key: JSON.stringify([scope, node.id]),
    title: node.title,
    kind: 'step',
    status: processStatus(node.status),
    ...(durationMs !== undefined && { durationMs }),
  };
}

export function toolProcessItem(
  tool: AgentToolSummary,
  historical = false
): ExecutionProcessItem {
  const status = processStatus(tool.status);
  return {
    key: JSON.stringify([tool.runId ?? null, tool.toolCallId]),
    title: tool.name,
    kind: 'tool',
    status:
      historical && (status === 'running' || status === 'pending')
        ? 'unknown'
        : status,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function workflowSnapshotItems(
  metadata: unknown,
  scope: string
): ExecutionProcessItem[] {
  const root = record(metadata);
  const errors = record(root?.error_details);
  const snapshots = [
    root?.node_executions,
    errors?.collected_node_data,
    errors?.collected_node_summary,
  ].find(Array.isArray);
  if (!Array.isArray(snapshots)) return [];
  return snapshots.flatMap((value, index) => {
    const node = record(value);
    if (!node || typeof node.node_id !== 'string' || !node.node_id.trim())
      return [];
    const status = processStatus(node.status);
    const durationMs =
      finiteNonnegative(node.elapsed_time) &&
      Number.isFinite(node.elapsed_time * 1000)
        ? node.elapsed_time * 1000
        : undefined;
    return [
      {
        key: JSON.stringify([scope, node.node_id, index]),
        title: typeof node.title === 'string' ? node.title : '',
        kind: 'step' as const,
        status:
          status === 'running' || status === 'pending'
            ? ('unknown' as const)
            : status,
        ...(durationMs !== undefined && { durationMs }),
      },
    ];
  });
}
