import type { WorkflowExecutionState } from './types';

export const workflowExecutionSelectors = {
  executionStatus: (state: WorkflowExecutionState) => ({
    isExecuting: state.isExecuting,
    progress: state.executionProgress,
    error: state.error,
    canRetry: state.canRetry,
  }),
  nodesStatus: (state: WorkflowExecutionState) => ({
    nodes: state.nodes,
    currentNodeId: state.currentNodeId,
  }),
  formStatus: (state: WorkflowExecutionState) => ({
    formData: state.formData,
    formLocked: state.formLocked,
  }),
  currentExecution: (state: WorkflowExecutionState) => state.currentExecution,
  executionHistory: (state: WorkflowExecutionState) => state.executionHistory,
  difyIds: (state: WorkflowExecutionState) => ({
    taskId: state.difyTaskId,
    workflowRunId: state.difyWorkflowRunId,
  }),
};
