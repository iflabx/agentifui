import type { AppExecution } from '@lib/types/database';
import { create } from 'zustand';

/**
 * Workflow iteration interface
 */
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

/**
 * Workflow parallel branch interface
 */
export interface WorkflowParallelBranch {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

interface WorkflowExecutionEventData extends Record<string, unknown> {
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

interface WorkflowExecutionEvent {
  event: string;
  data?: unknown;
}

/**
 * Workflow node state interface
 */
export interface WorkflowNode {
  id: string;
  title: string;
  type?: string; // Node type
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  description: string;
  visible: boolean;
  error?: string;

  // Iteration support
  isIterationNode?: boolean;
  totalIterations?: number;
  currentIteration?: number;
  iterations?: WorkflowIteration[];
  isInIteration?: boolean; // Is this a child node in an iteration
  iterationIndex?: number; // The round index of the child node in iteration

  // Loop support
  isLoopNode?: boolean;
  totalLoops?: number;
  currentLoop?: number;
  loops?: WorkflowLoop[];
  maxLoops?: number;
  isInLoop?: boolean; // Is this a child node in a loop
  loopIndex?: number; // The round index of the child node in loop

  // Parallel branch support
  isParallelNode?: boolean;
  totalBranches?: number;
  completedBranches?: number;
  parallelBranches?: WorkflowParallelBranch[];
}

/**
 * Workflow execution state interface
 */
interface WorkflowExecutionState {
  // --- Execution state ---
  isExecuting: boolean;
  executionProgress: number; // 0-100

  // --- Node tracking ---
  nodes: WorkflowNode[];
  currentNodeId: string | null;

  // --- Form management ---
  formData: Record<string, unknown>;
  formLocked: boolean;

  // --- Error handling ---
  error: string | null;
  canRetry: boolean;

  // --- Execution history ---
  executionHistory: AppExecution[];

  // --- Dify identifiers ---
  difyTaskId: string | null;
  difyWorkflowRunId: string | null;

  // --- Current execution record ---
  currentExecution: AppExecution | null;

  // Iteration and parallel branch state
  iterationExpandedStates: Record<string, boolean>;
  loopExpandedStates: Record<string, boolean>;

  // Current running iteration and loop state - structure consistent with chatflow
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

  // --- Actions ---
  startExecution: (formData: Record<string, unknown>) => void;
  stopExecution: () => void;
  setExecutionProgress: (progress: number) => void;

  // --- Node management ---
  addNode: (node: WorkflowNode) => void;
  updateNode: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  onNodeStarted: (nodeId: string, title: string, description: string) => void;
  onNodeFinished: (nodeId: string, success: boolean, error?: string) => void;
  resetNodes: () => void;

  // --- Form management ---
  setFormData: (data: Record<string, unknown>) => void;
  lockForm: () => void;
  unlockForm: () => void;
  resetFormData: () => void;

  // --- Error management ---
  setError: (error: string | null, canRetry?: boolean) => void;
  clearError: () => void;

  // --- Execution history management ---
  setExecutionHistory: (history: AppExecution[]) => void;
  addExecutionToHistory: (execution: AppExecution) => void;

  // --- Dify identifier management ---
  setDifyTaskId: (taskId: string | null) => void;
  setDifyWorkflowRunId: (runId: string | null) => void;

  // --- Current execution record management ---
  setCurrentExecution: (execution: AppExecution | null) => void;
  updateCurrentExecution: (updates: Partial<AppExecution>) => void;

  // Iteration and parallel branch management
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

  // SSE event handling
  handleNodeEvent: (event: WorkflowExecutionEvent) => void;

  // --- Reset state ---
  reset: () => void;
  clearAll: () => void; // Completely clear all state, including history
  clearExecutionState: () => void; // Only clear execution-related state, keep form data and history
}

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
    // --- Initial state ---
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
        // Mark all running nodes as stopped
        nodes: state.nodes.map(node => {
          if (node.status === 'running') {
            return {
              ...node,
              status: 'failed', // Keep as failed, since this is an interrupted execution
              error: 'Stopped by user',
              endTime: Date.now(),
              description: node.title + ' (Stopped)',
            };
          }
          // Also handle nodes in iteration
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
          // Also handle nodes in parallel branches
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
        }),
      }));
    },

    setExecutionProgress: (progress: number) => {
      set({ executionProgress: Math.max(0, Math.min(100, progress)) });
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
        nodes: state.nodes.map(node =>
          node.id === nodeId ? { ...node, ...updates } : node
        ),
      }));
    },

    onNodeStarted: (nodeId: string, title: string, description: string) => {
      console.log('[WorkflowStore] Node started:', nodeId, title);
      const now = Date.now();
      set(state => {
        const existingNode = state.nodes.find(n => n.id === nodeId);
        if (existingNode) {
          // Update existing node
          return {
            currentNodeId: nodeId,
            nodes: state.nodes.map(node =>
              node.id === nodeId
                ? {
                    ...node,
                    status: 'running',
                    startTime: now,
                    description,
                    visible: true,
                  }
                : node
            ),
          };
        } else {
          // Create new node
          const newNode: WorkflowNode = {
            id: nodeId,
            title,
            status: 'running',
            startTime: now,
            description,
            visible: true,
          };
          return {
            currentNodeId: nodeId,
            nodes: [...state.nodes, newNode],
          };
        }
      });
    },

    onNodeFinished: (nodeId: string, success: boolean, error?: string) => {
      console.log('[WorkflowStore] Node finished:', nodeId, success, error);
      const now = Date.now();
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? {
                ...node,
                status: success ? 'completed' : 'failed',
                endTime: now,
                error: error || undefined,
                description: success
                  ? node.title + ' completed'
                  : error || 'Execution failed',
              }
            : node
        ),
        currentNodeId: success ? null : state.currentNodeId,
      }));

      // Calculate execution progress
      const { nodes } = get();
      const completedNodes = nodes.filter(
        n => n.status === 'completed' || n.status === 'failed'
      ).length;
      const progress =
        nodes.length > 0 ? (completedNodes / nodes.length) * 100 : 0;
      set({ executionProgress: progress });
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
      const eventData = (event.data || {}) as WorkflowExecutionEventData;
      console.log('[WorkflowStore] Handle node event:', event.event, eventData);

      switch (event.event) {
        case 'node_started':
          const { node_id, node_type, title } = eventData;

          // Check if in iteration or loop, this is the core logic for child node marking - consistent with chatflow
          const { currentIteration, currentLoop } = get();
          const isInIteration = !!(
            currentIteration &&
            currentIteration.status === 'running' &&
            currentIteration.nodeId !== node_id
          );
          const isInLoop = !!(
            currentLoop &&
            currentLoop.status === 'running' &&
            currentLoop.nodeId !== node_id
          );

          // If this is a child node, add nesting marks
          if (isInIteration || isInLoop) {
            const existingNode = get().nodes.find(n => n.id === node_id);
            if (existingNode) {
              // Update existing node, add nesting marks
              get().updateNode(node_id, {
                status: 'running',
                startTime: Date.now(),
                description: 'Started',
                visible: true,
                isInIteration,
                isInLoop,
                iterationIndex: currentIteration?.index,
                loopIndex: currentLoop?.index,
              });
            } else {
              // Create new child node with nesting marks
              get().addNode({
                id: node_id,
                title: title || `${node_type} node`,
                type: node_type,
                status: 'running',
                startTime: Date.now(),
                description: 'Started',
                visible: true,
                isInIteration,
                isInLoop,
                iterationIndex: currentIteration?.index,
                loopIndex: currentLoop?.index,
              });
            }
          } else {
            // Normal node handling
            get().onNodeStarted(
              node_id,
              title || `${node_type} node`,
              'Started'
            );
          }
          break;

        case 'node_finished':
          const { node_id: finishedNodeId, status, error } = eventData;
          const success = status === 'succeeded';
          get().onNodeFinished(finishedNodeId, success, error);
          break;

        case 'iteration_started':
          const {
            node_id: iterNodeId,
            iteration_id,
            iteration_index,
            title: iterTitle,
            node_type: iterNodeType,
          } = eventData;
          // Use fallback logic consistent with chatflow to get total iterations
          const totalIterations =
            eventData.metadata?.iterator_length ||
            eventData.total_iterations ||
            1;

          console.log('[WorkflowStore] Iteration started debug:', {
            iterNodeId,
            'eventData.metadata': eventData.metadata,
            'eventData.total_iterations': eventData.total_iterations,
            'resolved totalIterations': totalIterations,
          });

          // Create or update iteration node
          const existingNode = get().nodes.find(n => n.id === iterNodeId);
          if (!existingNode) {
            get().addNode({
              id: iterNodeId,
              title: iterTitle || 'Iteration',
              type: iterNodeType || 'iteration',
              status: 'running',
              startTime: Date.now(),
              description: `Preparing iteration (total ${totalIterations} rounds)`,
              visible: true,
              isIterationNode: true,
              totalIterations: totalIterations,
              currentIteration: 0,
              iterations: [],
            });
          } else {
            get().updateNode(iterNodeId, {
              isIterationNode: true,
              totalIterations: totalIterations,
              currentIteration: 0,
              status: 'running',
              description: `Preparing iteration (total ${totalIterations} rounds)`,
            });
          }

          // Set current iteration state - this is key for child node marking
          set({
            currentIteration: {
              nodeId: iterNodeId,
              iterationId: iteration_id || `iter-${Date.now()}`,
              index: 0,
              totalIterations: totalIterations,
              startTime: Date.now(),
              status: 'running',
            },
          });

          // Auto expand iteration node
          set(state => ({
            iterationExpandedStates: {
              ...state.iterationExpandedStates,
              [iterNodeId]: true,
            },
          }));
          break;

        case 'iteration_next':
          const {
            node_id: nextNodeId,
            iteration_id: nextIterationId,
            iteration_index: nextIndex,
          } = eventData;

          // Update current iteration round
          const { currentIteration: currentIterState } = get();
          if (currentIterState && currentIterState.nodeId === nextNodeId) {
            // Increment logic consistent with chatflow
            const newIndex = currentIterState.index + 1;

            // Boundary check: prevent exceeding max iterations
            if (newIndex >= currentIterState.totalIterations) {
              console.warn(
                '[WorkflowStore] Received extra iteration_next event, already at max iterations:',
                {
                  currentIndex: currentIterState.index,
                  newIndex: newIndex,
                  total: currentIterState.totalIterations,
                }
              );
              break; // Ignore extra iteration_next event
            }

            console.log('[WorkflowStore] Iteration next round:', {
              internalIndex: newIndex,
              displayRound: newIndex + 1,
              totalRounds: currentIterState.totalIterations,
            });

            // Update node display - internal storage is 0-based index
            get().updateNode(nextNodeId, {
              currentIteration: newIndex,
              description: `Round ${newIndex + 1} / Total ${currentIterState.totalIterations} rounds`,
            });

            // Update current iteration state
            set({
              currentIteration: {
                ...currentIterState,
                index: newIndex,
                startTime: Date.now(),
              },
            });

            // Update all child nodes in iteration with round index
            const { nodes } = get();
            nodes.forEach(node => {
              if (node.isInIteration && !node.isIterationNode) {
                get().updateNode(node.id, {
                  iterationIndex: newIndex,
                });
              }
            });
          }
          break;

        case 'iteration_completed':
          const { node_id: completedNodeId } = eventData;
          get().updateNode(completedNodeId, {
            status: 'completed',
            endTime: Date.now(),
            description: 'Iteration completed',
          });
          // Clear current iteration state
          set(state => ({ currentIteration: null }));
          break;

        // Fully mimic chatflow's loop_started logic
        case 'loop_started':
          // Parse fields according to actual data structure, consistent with iteration_started
          const {
            id: loopId,
            node_id: loopNodeId,
            title: loopTitle,
            node_type: loopNodeType,
            metadata: loopMetadata,
            inputs: loopInputs,
          } = eventData;

          // Get max loop count from metadata or inputs
          const maxLoops =
            loopMetadata?.loop_length || loopInputs?.loop_count || undefined;
          const initialLoopIndex = 0; // Loop starts from 0, consistent with iteration

          console.log('[WorkflowStore] Loop started:', {
            loopNodeId,
            loopTitle,
            maxLoops,
            loopMetadata,
            loopInputs,
          });

          // Set current loop state - subsequent nodes will belong to this loop
          set({
            currentLoop: {
              nodeId: loopNodeId,
              loopId: loopId,
              index: initialLoopIndex,
              maxLoops: maxLoops,
              startTime: Date.now(),
              status: 'running',
            },
          });

          // Create loop container node if not exists, logic consistent with iteration
          const existingLoopNode = get().nodes.find(n => n.id === loopNodeId);
          if (!existingLoopNode) {
            get().addNode({
              id: loopNodeId,
              title: loopTitle || 'Loop',
              status: 'running',
              startTime: Date.now(),
              description: maxLoops
                ? `Preparing loop (max ${maxLoops} times)`
                : 'Preparing loop',
              type: loopNodeType || 'loop',
              visible: true,
              isLoopNode: true,
              maxLoops: maxLoops,
              currentLoop: initialLoopIndex,
            });
          } else {
            // Update existing loop container
            get().updateNode(loopNodeId, {
              description: maxLoops
                ? `Preparing loop (max ${maxLoops} times)`
                : 'Preparing loop',
              currentLoop: initialLoopIndex,
              status: 'running',
            });
          }

          // Auto expand loop node
          set(state => ({
            loopExpandedStates: {
              ...state.loopExpandedStates,
              [loopNodeId]: true,
            },
          }));
          break;

        case 'loop_next':
          // Increment logic consistent with chatflow and iteration_next
          const { node_id: nextLoopNodeId, index: nextLoopIndex } = eventData;
          const { currentLoop: currentLoopState } = get();

          if (currentLoopState && currentLoopState.nodeId === nextLoopNodeId) {
            // Increment logic consistent with chatflow
            const newLoopIndex = currentLoopState.index + 1;

            // Boundary check: prevent exceeding max loops
            if (
              currentLoopState.maxLoops &&
              newLoopIndex >= currentLoopState.maxLoops
            ) {
              console.warn(
                '[WorkflowStore] Received extra loop_next event, already at max loops:',
                {
                  currentIndex: currentLoopState.index,
                  newIndex: newLoopIndex,
                  max: currentLoopState.maxLoops,
                }
              );
              break; // Ignore extra loop_next event
            }

            console.log('[WorkflowStore] Loop next round:', {
              currentLoopStateIndex: currentLoopState.index,
              newInternalIndex: newLoopIndex,
              displayRound: newLoopIndex + 1,
              maxRounds: currentLoopState.maxLoops,
              'will set node.currentLoop to': newLoopIndex,
            });

            // Update current loop state
            set({
              currentLoop: {
                ...currentLoopState,
                index: newLoopIndex,
                startTime: Date.now(),
              },
            });

            // Update loop container node display - internal storage is 0-based index
            const maxLoopsText = currentLoopState.maxLoops
              ? ` / max ${currentLoopState.maxLoops} times`
              : '';
            get().updateNode(nextLoopNodeId, {
              description: `Round ${newLoopIndex + 1} loop${maxLoopsText}`,
              currentLoop: newLoopIndex,
            });

            // Update all child nodes in loop with round index
            const { nodes } = get();
            nodes.forEach(node => {
              if (node.isInLoop && !node.isLoopNode) {
                get().updateNode(node.id, {
                  loopIndex: newLoopIndex,
                });
              }
            });
          }
          break;

        case 'loop_completed':
          const { node_id: completedLoopNodeId, outputs: loopOutputs } =
            eventData;
          const { currentLoop: completedLoopState } = get();

          if (
            completedLoopState &&
            completedLoopState.nodeId === completedLoopNodeId
          ) {
            // Infer total loop count from outputs, or use current loop state's max rounds
            const finalLoopCount =
              loopOutputs?.loop_round ||
              completedLoopState.index + 1 ||
              completedLoopState.maxLoops ||
              0;

            // Update loop container node to completed state
            get().updateNode(completedLoopNodeId, {
              status: 'completed',
              endTime: Date.now(),
              description: `Loop completed (executed ${finalLoopCount} times)`,
              // Do not modify currentLoop field to avoid UI double increment
              totalLoops: finalLoopCount,
            });

            // Clear current loop state
            set({ currentLoop: null });

            // Keep isInLoop mark for child nodes so user can see the full hierarchy
            // Do not clear isInLoop so completed loop child nodes remain indented
          }
          break;

        case 'parallel_branch_started':
          const {
            node_id: parallelNodeId,
            parallel_id,
            parallel_run_id,
          } = eventData;

          // Create or update parallel branch node
          const existingParallelNode = get().nodes.find(
            n => n.id === parallelNodeId
          );
          if (!existingParallelNode) {
            get().addNode({
              id: parallelNodeId,
              title: 'Parallel Branch',
              type: 'parallel',
              status: 'running',
              startTime: Date.now(),
              description: 'Parallel execution in progress',
              visible: true,
              isParallelNode: true,
              totalBranches: 1,
              completedBranches: 0,
              parallelBranches: [],
            });
          }

          // Add branch
          get().addParallelBranch(parallelNodeId, {
            id: parallel_run_id,
            name: `Branch ${parallel_id}`,
            status: 'running',
            startTime: Date.now(),
          });
          break;

        case 'parallel_branch_finished':
          const {
            node_id: finishedParallelNodeId,
            parallel_run_id: finishedRunId,
            status: branchStatus,
          } = eventData;
          const branchSuccess = branchStatus === 'succeeded';

          get().completeParallelBranch(
            finishedParallelNodeId,
            finishedRunId,
            branchSuccess ? 'completed' : 'failed'
          );

          // Update completed branch count
          const parallelNode = get().nodes.find(
            n => n.id === finishedParallelNodeId
          );
          if (parallelNode) {
            const completedCount = (parallelNode.parallelBranches || []).filter(
              b => b.status === 'completed' || b.status === 'failed'
            ).length;

            get().updateNode(finishedParallelNodeId, {
              completedBranches: completedCount,
            });

            // If all branches are completed, mark node as completed
            if (completedCount === parallelNode.totalBranches) {
              get().updateNode(finishedParallelNodeId, {
                status: 'completed',
                endTime: Date.now(),
                description: 'Parallel execution completed',
              });
            }
          }
          break;

        case 'workflow_started':
          get().startExecution(get().formData);
          break;

        case 'workflow_finished':
          set({ isExecuting: false, currentNodeId: null });
          break;

        case 'workflow_interrupted':
          get().stopExecution();
          get().setError('Workflow interrupted');
          break;

        default:
          console.log('[WorkflowStore] Unhandled event type:', event.event);
      }
    },

    // --- Reset state ---
    reset: () => {
      console.log('[WorkflowStore] Reset all state (keep history)');
      set({
        isExecuting: false,
        executionProgress: 0,
        nodes: [],
        currentNodeId: null,
        formData: {},
        formLocked: false,
        error: null,
        canRetry: false,
        difyTaskId: null,
        difyWorkflowRunId: null,
        currentExecution: null,
        iterationExpandedStates: {},
        loopExpandedStates: {},
        currentIteration: null,
        currentLoop: null,
        // Note: do not reset executionHistory, keep history
      });
    },

    clearAll: () => {
      console.log('[WorkflowStore] Clear all state');
      set({
        isExecuting: false,
        executionProgress: 0,
        nodes: [],
        currentNodeId: null,
        formData: {},
        formLocked: false,
        error: null,
        canRetry: false,
        executionHistory: [], // Clear history
        difyTaskId: null,
        difyWorkflowRunId: null,
        currentExecution: null,
        iterationExpandedStates: {},
        loopExpandedStates: {},
        currentIteration: null,
        currentLoop: null,
      });
    },

    clearExecutionState: () => {
      console.log(
        '[WorkflowStore] Clear execution state (keep form data and history)'
      );
      set(state => ({
        isExecuting: false,
        executionProgress: 0,
        nodes: [],
        currentNodeId: null,
        formLocked: false,
        error: null,
        canRetry: false,
        difyTaskId: null,
        difyWorkflowRunId: null,
        currentExecution: null,
        iterationExpandedStates: {},
        loopExpandedStates: {},
        currentIteration: null,
        currentLoop: null,
        // Keep: formData, executionHistory
      }));
    },
  })
);

// --- Selector functions for optimizing component re-render ---
export const workflowExecutionSelectors = {
  // Execution status selector
  executionStatus: (state: WorkflowExecutionState) => ({
    isExecuting: state.isExecuting,
    progress: state.executionProgress,
    error: state.error,
    canRetry: state.canRetry,
  }),

  // Node status selector
  nodesStatus: (state: WorkflowExecutionState) => ({
    nodes: state.nodes,
    currentNodeId: state.currentNodeId,
  }),

  // Form status selector
  formStatus: (state: WorkflowExecutionState) => ({
    formData: state.formData,
    formLocked: state.formLocked,
  }),

  // Current execution selector
  currentExecution: (state: WorkflowExecutionState) => state.currentExecution,

  // Execution history selector
  executionHistory: (state: WorkflowExecutionState) => state.executionHistory,

  // Dify identifier selector
  difyIds: (state: WorkflowExecutionState) => ({
    taskId: state.difyTaskId,
    workflowRunId: state.difyWorkflowRunId,
  }),
};
