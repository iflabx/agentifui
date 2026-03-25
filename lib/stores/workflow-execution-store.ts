import type { AppExecution } from '@lib/types/database';
import { create } from 'zustand';

import { handleWorkflowExecutionNodeEvent } from './workflow-execution-store/event-handler';
import {
  calculateWorkflowProgress,
  clampExecutionProgress,
  finishWorkflowNode,
  markRunningWorkflowNodesStopped,
  updateWorkflowNodeCollection,
  upsertStartedWorkflowNode,
} from './workflow-execution-store/node-helpers';
import {
  createWorkflowExecutionBaseState,
  createWorkflowExecutionResetState,
} from './workflow-execution-store/state';
import type {
  WorkflowExecutionEvent,
  WorkflowExecutionState,
  WorkflowIteration,
  WorkflowLoop,
  WorkflowNode,
  WorkflowParallelBranch,
} from './workflow-execution-store/types';

export { workflowExecutionSelectors } from './workflow-execution-store/selectors';
export type {
  WorkflowExecutionEvent,
  WorkflowExecutionState,
  WorkflowIteration,
  WorkflowLoop,
  WorkflowNode,
  WorkflowParallelBranch,
} from './workflow-execution-store/types';

/**
 * Workflow execution state management store
 *
 * Main responsibilities:
 * - Manage the full lifecycle state of workflow execution
 * - Track node execution progress and state changes
 * - Manage form data and lock state
 * - Handle errors and retry logic
 * - Maintain execution history
 * - Sync Dify API identifiers
 * - Provide multiple methods to clear state
 */
export const useWorkflowExecutionStore = create<WorkflowExecutionState>(
  (set, get) => ({
    ...createWorkflowExecutionBaseState(),

    // --- Execution control ---
    startExecution: (formData: Record<string, unknown>) => {
      console.log('[WorkflowStore] Start execution, form data:', formData);
      set({
        isExecuting: true,
        executionProgress: 0,
        formData,
        formLocked: true,
        error: null,
        canRetry: false,
        nodes: [],
        currentNodeId: null,
        difyTaskId: null,
        difyWorkflowRunId: null,
      });
    },

    stopExecution: () => {
      console.log('[WorkflowStore] Stop execution');
      set(state => ({
        isExecuting: false,
        formLocked: false,
        currentNodeId: null,
        nodes: markRunningWorkflowNodesStopped(state.nodes),
      }));
    },

    setExecutionProgress: (progress: number) => {
      set({ executionProgress: clampExecutionProgress(progress) });
    },

    // --- Node management ---
    addNode: (node: WorkflowNode) => {
      console.log('[WorkflowStore] Add node:', node);
      set(state => ({
        nodes: [...state.nodes, node],
      }));
    },

    updateNode: (nodeId: string, updates: Partial<WorkflowNode>) => {
      console.log('[WorkflowStore] Update node:', nodeId, updates);
      set(state => ({
        nodes: updateWorkflowNodeCollection(state.nodes, nodeId, updates),
      }));
    },

    onNodeStarted: (nodeId: string, title: string, description: string) => {
      console.log('[WorkflowStore] Node started:', nodeId, title);
      const now = Date.now();
      set(state => {
        return {
          currentNodeId: nodeId,
          nodes: upsertStartedWorkflowNode(
            state.nodes,
            nodeId,
            title,
            description,
            now
          ),
        };
      });
    },

    onNodeFinished: (nodeId: string, success: boolean, error?: string) => {
      console.log('[WorkflowStore] Node finished:', nodeId, success, error);
      set(state => ({
        nodes: finishWorkflowNode(state.nodes, nodeId, success, error),
        currentNodeId: success ? null : state.currentNodeId,
      }));

      const { nodes } = get();
      set({ executionProgress: calculateWorkflowProgress(nodes) });
    },

    resetNodes: () => {
      console.log('[WorkflowStore] Reset nodes');
      set({
        nodes: [],
        currentNodeId: null,
        executionProgress: 0,
      });
    },

    // --- Form management ---
    setFormData: (data: Record<string, unknown>) => {
      set({ formData: data });
    },

    lockForm: () => {
      set({ formLocked: true });
    },

    unlockForm: () => {
      set({ formLocked: false });
    },

    resetFormData: () => {
      console.log('[WorkflowStore] Reset form data');
      set({
        formData: {},
        formLocked: false,
      });
    },

    // --- Error management ---
    setError: (error: string | null, canRetry: boolean = false) => {
      console.log('[WorkflowStore] Set error:', error, 'canRetry:', canRetry);
      set({
        error,
        canRetry,
        isExecuting: false,
        formLocked: false,
      });
    },

    clearError: () => {
      set({ error: null, canRetry: false });
    },

    // --- Execution history management ---
    setExecutionHistory: (history: AppExecution[]) => {
      set({ executionHistory: history });
    },

    addExecutionToHistory: (execution: AppExecution) => {
      console.log('[WorkflowStore] Add execution to history:', execution.id);
      set(state => ({
        executionHistory: [execution, ...state.executionHistory],
      }));
    },

    // --- Dify identifier management ---
    setDifyTaskId: (taskId: string | null) => {
      console.log('[WorkflowStore] Set Dify task ID:', taskId);
      set({ difyTaskId: taskId });
    },

    setDifyWorkflowRunId: (runId: string | null) => {
      console.log('[WorkflowStore] Set Dify workflow run ID:', runId);
      set({ difyWorkflowRunId: runId });
    },

    // --- Current execution record management ---
    setCurrentExecution: (execution: AppExecution | null) => {
      console.log('[WorkflowStore] Set current execution:', execution?.id);
      set({ currentExecution: execution });
    },

    updateCurrentExecution: (updates: Partial<AppExecution>) => {
      console.log('[WorkflowStore] Update current execution:', updates);
      set(state => ({
        currentExecution: state.currentExecution
          ? { ...state.currentExecution, ...updates }
          : null,
      }));
    },

    // Iteration and parallel branch management
    addIteration: (nodeId: string, iteration: WorkflowIteration) => {
      console.log('[WorkflowStore] Add iteration:', nodeId, iteration);
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? {
                ...node,
                iterations: [...(node.iterations || []), iteration],
              }
            : node
        ),
      }));
    },

    updateIteration: (
      nodeId: string,
      iterationId: string,
      updates: Partial<WorkflowIteration>
    ) => {
      console.log(
        '[WorkflowStore] Update iteration:',
        nodeId,
        iterationId,
        updates
      );
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? {
                ...node,
                iterations:
                  node.iterations?.map(iter =>
                    iter.id === iterationId ? { ...iter, ...updates } : iter
                  ) || [],
              }
            : node
        ),
      }));
    },

    completeIteration: (nodeId: string, iterationId: string) => {
      console.log('[WorkflowStore] Complete iteration:', nodeId, iterationId);
      get().updateIteration(nodeId, iterationId, {
        status: 'completed',
        endTime: Date.now(),
      });
    },

    // Loop management methods
    addLoop: (nodeId: string, loop: WorkflowLoop) => {
      console.log('[WorkflowStore] Add loop:', nodeId, loop);
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? {
                ...node,
                loops: [...(node.loops || []), loop],
              }
            : node
        ),
      }));
    },

    updateLoop: (
      nodeId: string,
      loopId: string,
      updates: Partial<WorkflowLoop>
    ) => {
      console.log('[WorkflowStore] Update loop:', nodeId, loopId, updates);
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? {
                ...node,
                loops:
                  node.loops?.map(loop =>
                    loop.id === loopId ? { ...loop, ...updates } : loop
                  ) || [],
              }
            : node
        ),
      }));
    },

    completeLoop: (nodeId: string, loopId: string) => {
      console.log('[WorkflowStore] Complete loop:', nodeId, loopId);
      get().updateLoop(nodeId, loopId, {
        status: 'completed',
        endTime: Date.now(),
      });
    },

    addParallelBranch: (nodeId: string, branch: WorkflowParallelBranch) => {
      console.log('[WorkflowStore] Add parallel branch:', nodeId, branch);
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? {
                ...node,
                parallelBranches: [...(node.parallelBranches || []), branch],
              }
            : node
        ),
      }));
    },

    updateParallelBranch: (
      nodeId: string,
      branchId: string,
      updates: Partial<WorkflowParallelBranch>
    ) => {
      console.log(
        '[WorkflowStore] Update parallel branch:',
        nodeId,
        branchId,
        updates
      );
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? {
                ...node,
                parallelBranches:
                  node.parallelBranches?.map(branch =>
                    branch.id === branchId ? { ...branch, ...updates } : branch
                  ) || [],
              }
            : node
        ),
      }));
    },

    completeParallelBranch: (
      nodeId: string,
      branchId: string,
      status: 'completed' | 'failed'
    ) => {
      console.log(
        '[WorkflowStore] Complete parallel branch:',
        nodeId,
        branchId,
        status
      );
      get().updateParallelBranch(nodeId, branchId, {
        status,
        endTime: Date.now(),
      });
    },

    toggleIterationExpanded: (nodeId: string) => {
      console.log('[WorkflowStore] Toggle iteration expanded:', nodeId);
      set(state => ({
        iterationExpandedStates: {
          ...state.iterationExpandedStates,
          [nodeId]: !state.iterationExpandedStates[nodeId],
        },
      }));
    },

    toggleLoopExpanded: (nodeId: string) => {
      console.log('[WorkflowStore] Toggle loop expanded:', nodeId);
      set(state => ({
        loopExpandedStates: {
          ...state.loopExpandedStates,
          [nodeId]: !state.loopExpandedStates[nodeId],
        },
      }));
    },

    // SSE event handling - refer to chatflow implementation
    handleNodeEvent: (event: WorkflowExecutionEvent) => {
      handleWorkflowExecutionNodeEvent(event, {
        getState: get,
        setState: set,
        addNode: get().addNode,
        updateNode: get().updateNode,
        onNodeStarted: get().onNodeStarted,
        onNodeFinished: get().onNodeFinished,
        addParallelBranch: get().addParallelBranch,
        completeParallelBranch: get().completeParallelBranch,
        startExecution: get().startExecution,
        stopExecution: get().stopExecution,
        setError: get().setError,
      });
    },

    // --- Reset state ---
    reset: () => {
      console.log('[WorkflowStore] Reset all state (keep history)');
      set(createWorkflowExecutionResetState(true, false, get()));
    },

    clearAll: () => {
      console.log('[WorkflowStore] Clear all state');
      set(createWorkflowExecutionResetState(false, false));
    },

    clearExecutionState: () => {
      console.log(
        '[WorkflowStore] Clear execution state (keep form data and history)'
      );
      set(createWorkflowExecutionResetState(true, true, get()));
    },
  })
);
