import type { WorkflowExecutionState } from './types';

export function createWorkflowExecutionBaseState(): Pick<
  WorkflowExecutionState,
  | 'isExecuting'
  | 'executionProgress'
  | 'nodes'
  | 'currentNodeId'
  | 'formData'
  | 'formLocked'
  | 'error'
  | 'canRetry'
  | 'executionHistory'
  | 'difyTaskId'
  | 'difyWorkflowRunId'
  | 'currentExecution'
  | 'iterationExpandedStates'
  | 'loopExpandedStates'
  | 'currentIteration'
  | 'currentLoop'
> {
  return {
    isExecuting: false,
    executionProgress: 0,
    nodes: [],
    currentNodeId: null,
    formData: {},
    formLocked: false,
    error: null,
    canRetry: false,
    executionHistory: [],
    difyTaskId: null,
    difyWorkflowRunId: null,
    currentExecution: null,
    iterationExpandedStates: {},
    loopExpandedStates: {},
    currentIteration: null,
    currentLoop: null,
  };
}

export function createWorkflowExecutionResetState(
  preserveHistory: boolean,
  preserveFormData: boolean,
  currentState?: WorkflowExecutionState
) {
  return {
    isExecuting: false,
    executionProgress: 0,
    nodes: [],
    currentNodeId: null,
    formData: preserveFormData ? currentState?.formData || {} : {},
    formLocked: false,
    error: null,
    canRetry: false,
    executionHistory: preserveHistory
      ? currentState?.executionHistory || []
      : [],
    difyTaskId: null,
    difyWorkflowRunId: null,
    currentExecution: null,
    iterationExpandedStates: {},
    loopExpandedStates: {},
    currentIteration: null,
    currentLoop: null,
  };
}
