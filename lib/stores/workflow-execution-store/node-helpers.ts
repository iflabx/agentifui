import type { WorkflowNode } from './types';

export function clampExecutionProgress(progress: number): number {
  return Math.max(0, Math.min(100, progress));
}

export function markRunningWorkflowNodesStopped(
  nodes: WorkflowNode[]
): WorkflowNode[] {
  return nodes.map(node => {
    if (node.status === 'running') {
      return {
        ...node,
        status: 'failed',
        error: 'Stopped by user',
        endTime: Date.now(),
        description: `${node.title} (Stopped)`,
      };
    }
    if (node.iterations) {
      return {
        ...node,
        iterations: node.iterations.map(iteration =>
          iteration.status === 'running'
            ? { ...iteration, status: 'failed', endTime: Date.now() }
            : iteration
        ),
      };
    }
    if (node.parallelBranches) {
      return {
        ...node,
        parallelBranches: node.parallelBranches.map(branch =>
          branch.status === 'running'
            ? { ...branch, status: 'failed', endTime: Date.now() }
            : branch
        ),
      };
    }
    return node;
  });
}

export function updateWorkflowNodeCollection(
  nodes: WorkflowNode[],
  nodeId: string,
  updates: Partial<WorkflowNode>
): WorkflowNode[] {
  return nodes.map(node =>
    node.id === nodeId ? { ...node, ...updates } : node
  );
}

export function upsertStartedWorkflowNode(
  nodes: WorkflowNode[],
  nodeId: string,
  title: string,
  description: string,
  now: number
): WorkflowNode[] {
  const existingNode = nodes.find(node => node.id === nodeId);
  if (existingNode) {
    return updateWorkflowNodeCollection(nodes, nodeId, {
      status: 'running',
      startTime: now,
      description,
      visible: true,
    });
  }

  return [
    ...nodes,
    {
      id: nodeId,
      title,
      status: 'running',
      startTime: now,
      description,
      visible: true,
    },
  ];
}

export function finishWorkflowNode(
  nodes: WorkflowNode[],
  nodeId: string,
  success: boolean,
  error?: string
): WorkflowNode[] {
  const now = Date.now();
  return updateWorkflowNodeCollection(nodes, nodeId, {
    status: success ? 'completed' : 'failed',
    endTime: now,
    error: error || undefined,
    description: success ? `${nodeId} completed` : error || 'Execution failed',
  }).map(node =>
    node.id === nodeId
      ? {
          ...node,
          description: success
            ? `${node.title} completed`
            : error || 'Execution failed',
        }
      : node
  );
}

export function calculateWorkflowProgress(nodes: WorkflowNode[]): number {
  const completedNodes = nodes.filter(
    node => node.status === 'completed' || node.status === 'failed'
  ).length;
  return nodes.length > 0 ? (completedNodes / nodes.length) * 100 : 0;
}
