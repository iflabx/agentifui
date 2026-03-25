import type { AppExecution } from '@lib/types/database';

export interface WorkflowIteration {
  id: string;
  index: number;
  status: 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

export interface WorkflowLoop {
  id: string;
  index: number;
  status: 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

export interface WorkflowParallelBranch {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

export interface WorkflowExecutionEventData extends Record<string, unknown> {
  node_id: string;
  node_type: string;
  title: string;
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
  parallel_id: string | number;
  parallel_run_id: string;
}

export interface WorkflowExecutionEvent {
  event: string;
  data?: unknown;
}

export interface WorkflowNode {
  id: string;
  title: string;
  type?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  description: string;
  visible: boolean;
  error?: string;
  isIterationNode?: boolean;
  totalIterations?: number;
  currentIteration?: number;
  iterations?: WorkflowIteration[];
  isInIteration?: boolean;
  iterationIndex?: number;
  isLoopNode?: boolean;
  totalLoops?: number;
  currentLoop?: number;
  loops?: WorkflowLoop[];
  maxLoops?: number;
  isInLoop?: boolean;
  loopIndex?: number;
  isParallelNode?: boolean;
  totalBranches?: number;
  completedBranches?: number;
  parallelBranches?: WorkflowParallelBranch[];
}

export interface WorkflowExecutionState {
  isExecuting: boolean;
  executionProgress: number;
  nodes: WorkflowNode[];
  currentNodeId: string | null;
  formData: Record<string, unknown>;
  formLocked: boolean;
  error: string | null;
  canRetry: boolean;
  executionHistory: AppExecution[];
  difyTaskId: string | null;
  difyWorkflowRunId: string | null;
  currentExecution: AppExecution | null;
  iterationExpandedStates: Record<string, boolean>;
  loopExpandedStates: Record<string, boolean>;
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
  startExecution: (formData: Record<string, unknown>) => void;
  stopExecution: () => void;
  setExecutionProgress: (progress: number) => void;
  addNode: (node: WorkflowNode) => void;
  updateNode: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  onNodeStarted: (nodeId: string, title: string, description: string) => void;
  onNodeFinished: (nodeId: string, success: boolean, error?: string) => void;
  resetNodes: () => void;
  setFormData: (data: Record<string, unknown>) => void;
  lockForm: () => void;
  unlockForm: () => void;
  resetFormData: () => void;
  setError: (error: string | null, canRetry?: boolean) => void;
  clearError: () => void;
  setExecutionHistory: (history: AppExecution[]) => void;
  addExecutionToHistory: (execution: AppExecution) => void;
  setDifyTaskId: (taskId: string | null) => void;
  setDifyWorkflowRunId: (runId: string | null) => void;
  setCurrentExecution: (execution: AppExecution | null) => void;
  updateCurrentExecution: (updates: Partial<AppExecution>) => void;
  addIteration: (nodeId: string, iteration: WorkflowIteration) => void;
  updateIteration: (
    nodeId: string,
    iterationId: string,
    updates: Partial<WorkflowIteration>
  ) => void;
  completeIteration: (nodeId: string, iterationId: string) => void;
  addLoop: (nodeId: string, loop: WorkflowLoop) => void;
  updateLoop: (
    nodeId: string,
    loopId: string,
    updates: Partial<WorkflowLoop>
  ) => void;
  completeLoop: (nodeId: string, loopId: string) => void;
  addParallelBranch: (nodeId: string, branch: WorkflowParallelBranch) => void;
  updateParallelBranch: (
    nodeId: string,
    branchId: string,
    updates: Partial<WorkflowParallelBranch>
  ) => void;
  completeParallelBranch: (
    nodeId: string,
    branchId: string,
    status: 'completed' | 'failed'
  ) => void;
  toggleIterationExpanded: (nodeId: string) => void;
  toggleLoopExpanded: (nodeId: string) => void;
  handleNodeEvent: (event: WorkflowExecutionEvent) => void;
  reset: () => void;
  clearAll: () => void;
  clearExecutionState: () => void;
}
