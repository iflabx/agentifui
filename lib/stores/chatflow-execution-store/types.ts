export interface ChatflowNode {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  description?: string;
  type?: string;
  visible?: boolean;
  iterations?: ChatflowIteration[];
  currentIteration?: number;
  totalIterations?: number;
  isIterationNode?: boolean;
  isInIteration?: boolean;
  iterationIndex?: number;
  isInLoop?: boolean;
  loopIndex?: number;
  parallelBranches?: ChatflowParallelBranch[];
  totalBranches?: number;
  completedBranches?: number;
  isParallelNode?: boolean;
  loops?: ChatflowLoop[];
  currentLoop?: number;
  totalLoops?: number;
  isLoopNode?: boolean;
  maxLoops?: number;
}

export interface ChatflowIteration {
  id: string;
  index: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  description?: string;
}

export interface ChatflowParallelBranch {
  id: string;
  index: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  description?: string;
}

export interface ChatflowLoop {
  id: string;
  index: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  description?: string;
  maxLoops?: number;
}

export interface ChatflowNodeEventData extends Record<string, unknown> {
  node_id: string;
  title: string;
  node_type: string;
  status: string;
  error: string;
  iteration_id: string;
  iteration_index: number;
  total_iterations: number;
  metadata?: {
    iterator_length?: number;
    loop_length?: number;
  };
  inputs?: {
    loop_count?: number;
  } & Record<string, unknown>;
  id: string;
  index: number;
  outputs?: {
    loop_round?: number;
  } & Record<string, unknown>;
  branch_id: string;
  branch_index: number;
  total_branches: number;
}

export interface ChatflowNodeEvent {
  event: string;
  data?: unknown;
}

export interface ChatflowExecutionProgress {
  current: number;
  total: number;
  percentage: number;
}

export interface ChatflowExecutionState {
  nodes: ChatflowNode[];
  currentNodeId: string | null;
  isExecuting: boolean;
  currentIteration: {
    nodeId: string;
    iterationId: string;
    index: number;
    totalIterations: number;
    startTime: number;
    status: 'running' | 'completed';
  } | null;
  currentLoop: {
    nodeId: string;
    loopId: string;
    index: number;
    maxLoops?: number;
    startTime: number;
    status: 'running' | 'completed';
  } | null;
  iterationExpandedStates: Record<string, boolean>;
  loopExpandedStates: Record<string, boolean>;
  executionProgress: ChatflowExecutionProgress;
  error: string | null;
  canRetry: boolean;
  startExecution: () => void;
  stopExecution: () => void;
  resetExecution: () => void;
  addNode: (node: ChatflowNode) => void;
  updateNode: (nodeId: string, updates: Partial<ChatflowNode>) => void;
  setCurrentNode: (nodeId: string | null) => void;
  addIteration: (nodeId: string, iteration: ChatflowIteration) => void;
  updateIteration: (
    nodeId: string,
    iterationId: string,
    updates: Partial<ChatflowIteration>
  ) => void;
  completeIteration: (nodeId: string, iterationId: string) => void;
  addParallelBranch: (nodeId: string, branch: ChatflowParallelBranch) => void;
  updateParallelBranch: (
    nodeId: string,
    branchId: string,
    updates: Partial<ChatflowParallelBranch>
  ) => void;
  completeParallelBranch: (
    nodeId: string,
    branchId: string,
    status: 'completed' | 'failed'
  ) => void;
  addLoop: (nodeId: string, loop: ChatflowLoop) => void;
  updateLoop: (
    nodeId: string,
    loopId: string,
    updates: Partial<ChatflowLoop>
  ) => void;
  completeLoop: (nodeId: string, loopId: string) => void;
  setError: (error: string | null) => void;
  setCanRetry: (canRetry: boolean) => void;
  toggleIterationExpanded: (nodeId: string) => void;
  toggleLoopExpanded: (nodeId: string) => void;
  handleNodeEvent: (event: ChatflowNodeEvent) => void;
}
