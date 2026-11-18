import type {
  ChatflowExecutionState,
  ChatflowIteration,
  ChatflowLoop,
  ChatflowNode,
  ChatflowParallelBranch,
} from './types';

export const CHATFLOW_EXECUTION_METADATA_KEY = 'chatflow_execution';
const CHATFLOW_EXECUTION_METADATA_VERSION = 1;

export interface ChatflowExecutionMetadata {
  version: number;
  status: 'completed' | 'failed' | 'stopped';
  nodes: ChatflowNode[];
}

function snapshotIteration(iteration: ChatflowIteration): ChatflowIteration {
  return {
    id: iteration.id,
    index: iteration.index,
    status: iteration.status,
    startTime: iteration.startTime,
    ...(iteration.endTime !== undefined ? { endTime: iteration.endTime } : {}),
    ...(iteration.error ? { error: iteration.error } : {}),
    ...(iteration.description ? { description: iteration.description } : {}),
  };
}

function snapshotLoop(loop: ChatflowLoop): ChatflowLoop {
  return {
    id: loop.id,
    index: loop.index,
    status: loop.status,
    startTime: loop.startTime,
    ...(loop.endTime !== undefined ? { endTime: loop.endTime } : {}),
    ...(loop.error ? { error: loop.error } : {}),
    ...(loop.description ? { description: loop.description } : {}),
    ...(loop.maxLoops !== undefined ? { maxLoops: loop.maxLoops } : {}),
  };
}

function snapshotParallelBranch(
  branch: ChatflowParallelBranch
): ChatflowParallelBranch {
  return {
    id: branch.id,
    index: branch.index,
    status: branch.status,
    startTime: branch.startTime,
    ...(branch.endTime !== undefined ? { endTime: branch.endTime } : {}),
    ...(branch.error ? { error: branch.error } : {}),
    ...(branch.description ? { description: branch.description } : {}),
  };
}

function snapshotNode(node: ChatflowNode): ChatflowNode {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    ...(node.startTime !== undefined ? { startTime: node.startTime } : {}),
    ...(node.endTime !== undefined ? { endTime: node.endTime } : {}),
    ...(node.description ? { description: node.description } : {}),
    ...(node.type ? { type: node.type } : {}),
    ...(node.visible !== undefined ? { visible: node.visible } : {}),
    ...(node.totalIterations !== undefined
      ? { totalIterations: node.totalIterations }
      : {}),
    ...(node.currentIteration !== undefined
      ? { currentIteration: node.currentIteration }
      : {}),
    ...(node.isIterationNode ? { isIterationNode: true } : {}),
    ...(node.isInIteration ? { isInIteration: true } : {}),
    ...(node.iterationIndex !== undefined
      ? { iterationIndex: node.iterationIndex }
      : {}),
    ...(node.totalLoops !== undefined ? { totalLoops: node.totalLoops } : {}),
    ...(node.currentLoop !== undefined
      ? { currentLoop: node.currentLoop }
      : {}),
    ...(node.isLoopNode ? { isLoopNode: true } : {}),
    ...(node.isInLoop ? { isInLoop: true } : {}),
    ...(node.loopIndex !== undefined ? { loopIndex: node.loopIndex } : {}),
    ...(node.maxLoops !== undefined ? { maxLoops: node.maxLoops } : {}),
    ...(node.totalBranches !== undefined
      ? { totalBranches: node.totalBranches }
      : {}),
    ...(node.completedBranches !== undefined
      ? { completedBranches: node.completedBranches }
      : {}),
    ...(node.isParallelNode ? { isParallelNode: true } : {}),
    ...(node.iterations?.length
      ? { iterations: node.iterations.map(snapshotIteration) }
      : {}),
    ...(node.loops?.length ? { loops: node.loops.map(snapshotLoop) } : {}),
    ...(node.parallelBranches?.length
      ? {
          parallelBranches: node.parallelBranches.map(snapshotParallelBranch),
        }
      : {}),
  };
}

export function buildChatflowExecutionMetadata(
  state: Pick<
    ChatflowExecutionState,
    'nodes' | 'isExecuting' | 'error' | 'wasStopped'
  >
): Record<string, unknown> | undefined {
  if (state.nodes.length === 0) {
    return undefined;
  }

  return {
    [CHATFLOW_EXECUTION_METADATA_KEY]: {
      version: CHATFLOW_EXECUTION_METADATA_VERSION,
      status: state.error
        ? 'failed'
        : state.wasStopped
          ? 'stopped'
          : 'completed',
      nodes: state.nodes.map(snapshotNode),
    } satisfies ChatflowExecutionMetadata,
  };
}

function isStatus(
  value: unknown
): value is ChatflowExecutionMetadata['status'] {
  return value === 'completed' || value === 'failed' || value === 'stopped';
}

function isNode(value: unknown): value is ChatflowNode {
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  return (
    typeof node.id === 'string' &&
    typeof node.title === 'string' &&
    (node.status === 'pending' ||
      node.status === 'running' ||
      node.status === 'completed' ||
      node.status === 'failed')
  );
}

export function readChatflowExecutionMetadata(
  metadata: Record<string, unknown> | null | undefined
): ChatflowExecutionMetadata | null {
  const value = metadata?.[CHATFLOW_EXECUTION_METADATA_KEY];
  if (!value || typeof value !== 'object') return null;

  const snapshot = value as Partial<ChatflowExecutionMetadata>;
  if (
    snapshot.version !== CHATFLOW_EXECUTION_METADATA_VERSION ||
    !isStatus(snapshot.status) ||
    !Array.isArray(snapshot.nodes) ||
    snapshot.nodes.length === 0 ||
    !snapshot.nodes.every(isNode)
  ) {
    return null;
  }

  return {
    version: snapshot.version,
    status: snapshot.status,
    nodes: snapshot.nodes,
  };
}
