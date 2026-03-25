import type {
  ChatflowExecutionProgress,
  ChatflowNode,
  ChatflowParallelBranch,
  ChatflowIteration,
  ChatflowLoop,
} from './types';

function mapChatflowNodeById(
  nodes: ChatflowNode[],
  nodeId: string,
  updater: (node: ChatflowNode) => ChatflowNode
): ChatflowNode[] {
  return nodes.map(node => (node.id === nodeId ? updater(node) : node));
}

export function markRunningChatflowNodesStopped(
  nodes: ChatflowNode[]
): ChatflowNode[] {
  return nodes.map(node =>
    node.status === 'running'
      ? { ...node, status: 'failed', endTime: Date.now() }
      : node
  );
}

export function calculateChatflowExecutionProgress(
  nodes: ChatflowNode[]
): ChatflowExecutionProgress {
  const completedNodes = nodes.filter(node => node.status === 'completed').length;
  const totalNodes = nodes.length;

  return {
    current: completedNodes,
    total: totalNodes,
    percentage: totalNodes > 0 ? (completedNodes / totalNodes) * 100 : 0,
  };
}

export function updateChatflowNodeCollection(
  nodes: ChatflowNode[],
  nodeId: string,
  updates: Partial<ChatflowNode>
): ChatflowNode[] {
  return mapChatflowNodeById(nodes, nodeId, node => ({ ...node, ...updates }));
}

export function appendChatflowNode(
  nodes: ChatflowNode[],
  node: ChatflowNode
): ChatflowNode[] {
  return [...nodes, node];
}

export function addChatflowIteration(
  nodes: ChatflowNode[],
  nodeId: string,
  iteration: ChatflowIteration
): ChatflowNode[] {
  return mapChatflowNodeById(nodes, nodeId, node => ({
    ...node,
    iterations: [...(node.iterations || []), iteration],
  }));
}

export function updateChatflowIteration(
  nodes: ChatflowNode[],
  nodeId: string,
  iterationId: string,
  updates: Partial<ChatflowIteration>
): ChatflowNode[] {
  return mapChatflowNodeById(nodes, nodeId, node => ({
    ...node,
    iterations: node.iterations?.map(iteration =>
      iteration.id === iterationId ? { ...iteration, ...updates } : iteration
    ),
  }));
}

export function removeChatflowIteration(
  nodes: ChatflowNode[],
  nodeId: string,
  iterationId: string
): ChatflowNode[] {
  return mapChatflowNodeById(nodes, nodeId, node => ({
    ...node,
    iterations: node.iterations?.filter(iteration => iteration.id !== iterationId),
  }));
}

export function addChatflowParallelBranch(
  nodes: ChatflowNode[],
  nodeId: string,
  branch: ChatflowParallelBranch
): ChatflowNode[] {
  return mapChatflowNodeById(nodes, nodeId, node => ({
    ...node,
    parallelBranches: [...(node.parallelBranches || []), branch],
  }));
}

export function updateChatflowParallelBranch(
  nodes: ChatflowNode[],
  nodeId: string,
  branchId: string,
  updates: Partial<ChatflowParallelBranch>
): ChatflowNode[] {
  return mapChatflowNodeById(nodes, nodeId, node => ({
    ...node,
    parallelBranches: node.parallelBranches?.map(branch =>
      branch.id === branchId ? { ...branch, ...updates } : branch
    ),
  }));
}

export function removeChatflowParallelBranch(
  nodes: ChatflowNode[],
  nodeId: string,
  branchId: string
): ChatflowNode[] {
  return mapChatflowNodeById(nodes, nodeId, node => ({
    ...node,
    parallelBranches: node.parallelBranches?.filter(branch => branch.id !== branchId),
  }));
}

export function addChatflowLoop(
  nodes: ChatflowNode[],
  nodeId: string,
  loop: ChatflowLoop
): ChatflowNode[] {
  return mapChatflowNodeById(nodes, nodeId, node => ({
    ...node,
    loops: [...(node.loops || []), loop],
  }));
}

export function updateChatflowLoop(
  nodes: ChatflowNode[],
  nodeId: string,
  loopId: string,
  updates: Partial<ChatflowLoop>
): ChatflowNode[] {
  return mapChatflowNodeById(nodes, nodeId, node => ({
    ...node,
    loops: node.loops?.map(loop =>
      loop.id === loopId ? { ...loop, ...updates } : loop
    ),
  }));
}

export function removeChatflowLoop(
  nodes: ChatflowNode[],
  nodeId: string,
  loopId: string
): ChatflowNode[] {
  return mapChatflowNodeById(nodes, nodeId, node => ({
    ...node,
    loops: node.loops?.filter(loop => loop.id !== loopId),
  }));
}
