import { create } from 'zustand';

export interface ChatflowNode {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  description?: string;
  type?: string;
  visible?: boolean;

  // Iteration support
  iterations?: ChatflowIteration[];
  currentIteration?: number;
  totalIterations?: number;
  isIterationNode?: boolean;

  // Whether the node is inside an iteration
  isInIteration?: boolean;
  iterationIndex?: number;

  // Whether the node is inside a loop
  isInLoop?: boolean;
  loopIndex?: number;

  // Parallel branch support
  parallelBranches?: ChatflowParallelBranch[];
  totalBranches?: number;
  completedBranches?: number;
  isParallelNode?: boolean;

  // Loop support
  loops?: ChatflowLoop[];
  currentLoop?: number;
  totalLoops?: number;
  isLoopNode?: boolean;
  maxLoops?: number;
}

// Iteration data structure
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

// Parallel branch data structure
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

// Loop data structure
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
  maxLoops?: number; // Maximum loop count limit
}

interface ChatflowNodeEventData extends Record<string, unknown> {
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

interface ChatflowNodeEvent {
  event: string;
  data?: unknown;
}

interface ChatflowExecutionState {
  // Node state
  nodes: ChatflowNode[];
  currentNodeId: string | null;
  isExecuting: boolean;

  // Current iteration tracking
  currentIteration: {
    nodeId: string;
    iterationId: string;
    index: number;
    totalIterations: number;
    startTime: number;
    status: 'running' | 'completed';
  } | null;

  // Current loop tracking
  currentLoop: {
    nodeId: string;
    loopId: string;
    index: number;
    maxLoops?: number;
    startTime: number;
    status: 'running' | 'completed';
  } | null;

  // Iteration node expanded state
  iterationExpandedStates: Record<string, boolean>;

  // Loop node expanded state
  loopExpandedStates: Record<string, boolean>;

  // Execution progress
  executionProgress: {
    current: number;
    total: number;
    percentage: number;
  };

  // Error state
  error: string | null;
  canRetry: boolean;

  // Actions
  startExecution: () => void;
  stopExecution: () => void;
  resetExecution: () => void;

  addNode: (node: ChatflowNode) => void;
  updateNode: (nodeId: string, updates: Partial<ChatflowNode>) => void;
  setCurrentNode: (nodeId: string | null) => void;

  // Iteration actions
  addIteration: (nodeId: string, iteration: ChatflowIteration) => void;
  updateIteration: (
    nodeId: string,
    iterationId: string,
    updates: Partial<ChatflowIteration>
  ) => void;
  completeIteration: (nodeId: string, iterationId: string) => void;

  // Parallel branch actions
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

  // Loop actions
  addLoop: (nodeId: string, loop: ChatflowLoop) => void;
  updateLoop: (
    nodeId: string,
    loopId: string,
    updates: Partial<ChatflowLoop>
  ) => void;
  completeLoop: (nodeId: string, loopId: string) => void;

  setError: (error: string | null) => void;
  setCanRetry: (canRetry: boolean) => void;

  // Iteration expanded state management
  toggleIterationExpanded: (nodeId: string) => void;

  // Loop expanded state management
  toggleLoopExpanded: (nodeId: string) => void;

  // Update state from SSE event
  handleNodeEvent: (event: ChatflowNodeEvent) => void;
}

export const useChatflowExecutionStore = create<ChatflowExecutionState>(
  (set, get) => ({
    // Initial state
    nodes: [],
    currentNodeId: null,
    isExecuting: false,
    currentIteration: null,
    currentLoop: null,
    iterationExpandedStates: {},
    loopExpandedStates: {},

    executionProgress: {
      current: 0,
      total: 0,
      percentage: 0,
    },

    error: null,
    canRetry: false,

    // Actions
    startExecution: () => {
      console.log('[ChatflowExecution] Execution started');
      set({
        isExecuting: true,
        error: null,
        canRetry: false,
        nodes: [],
        currentNodeId: null,
        executionProgress: { current: 0, total: 0, percentage: 0 },
      });
    },

    stopExecution: () => {
      const { nodes } = get();
      const updatedNodes = nodes.map(node =>
        node.status === 'running'
          ? { ...node, status: 'failed' as const, endTime: Date.now() }
          : node
      );

      set({
        isExecuting: false,
        nodes: updatedNodes,
        currentNodeId: null,
        canRetry: true,
      });
    },

    resetExecution: () => {
      set({
        nodes: [],
        currentNodeId: null,
        isExecuting: false,
        executionProgress: { current: 0, total: 0, percentage: 0 },
        error: null,
        canRetry: false,
      });
    },

    addNode: (node: ChatflowNode) => {
      set(state => ({
        nodes: [...state.nodes, node],
      }));
    },

    updateNode: (nodeId: string, updates: Partial<ChatflowNode>) => {
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId ? { ...node, ...updates } : node
        ),
      }));

      // Update progress
      const { nodes } = get();
      const completedNodes = nodes.filter(n => n.status === 'completed').length;
      const totalNodes = nodes.length;

      set({
        executionProgress: {
          current: completedNodes,
          total: totalNodes,
          percentage: totalNodes > 0 ? (completedNodes / totalNodes) * 100 : 0,
        },
      });
    },

    setCurrentNode: (nodeId: string | null) => {
      set({ currentNodeId: nodeId });
    },

    // Iteration actions
    addIteration: (nodeId: string, iteration: ChatflowIteration) => {
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? { ...node, iterations: [...(node.iterations || []), iteration] }
            : node
        ),
      }));
    },

    updateIteration: (
      nodeId: string,
      iterationId: string,
      updates: Partial<ChatflowIteration>
    ) => {
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? {
                ...node,
                iterations: node.iterations?.map(iteration =>
                  iteration.id === iterationId
                    ? { ...iteration, ...updates }
                    : iteration
                ),
              }
            : node
        ),
      }));
    },

    completeIteration: (nodeId: string, iterationId: string) => {
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? {
                ...node,
                iterations: node.iterations?.filter(
                  iteration => iteration.id !== iterationId
                ),
              }
            : node
        ),
      }));
    },

    // Parallel branch actions
    addParallelBranch: (nodeId: string, branch: ChatflowParallelBranch) => {
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
      updates: Partial<ChatflowParallelBranch>
    ) => {
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? {
                ...node,
                parallelBranches: node.parallelBranches?.map(branch =>
                  branch.id === branchId ? { ...branch, ...updates } : branch
                ),
              }
            : node
        ),
      }));
    },

    completeParallelBranch: (
      nodeId: string,
      branchId: string,
      _status: 'completed' | 'failed'
    ) => {
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? {
                ...node,
                parallelBranches: node.parallelBranches?.filter(
                  branch => branch.id !== branchId
                ),
              }
            : node
        ),
      }));
    },

    // Loop actions
    addLoop: (nodeId: string, loop: ChatflowLoop) => {
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? { ...node, loops: [...(node.loops || []), loop] }
            : node
        ),
      }));
    },

    updateLoop: (
      nodeId: string,
      loopId: string,
      updates: Partial<ChatflowLoop>
    ) => {
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? {
                ...node,
                loops: node.loops?.map(loop =>
                  loop.id === loopId ? { ...loop, ...updates } : loop
                ),
              }
            : node
        ),
      }));
    },

    completeLoop: (nodeId: string, loopId: string) => {
      set(state => ({
        nodes: state.nodes.map(node =>
          node.id === nodeId
            ? {
                ...node,
                loops: node.loops?.filter(loop => loop.id !== loopId),
              }
            : node
        ),
      }));
    },

    setError: (error: string | null) => {
      set({ error, canRetry: !!error });
    },

    setCanRetry: (canRetry: boolean) => {
      set({ canRetry });
    },

    // Toggle iteration expanded state
    toggleIterationExpanded: (nodeId: string) => {
      set(state => ({
        iterationExpandedStates: {
          ...state.iterationExpandedStates,
          [nodeId]: !state.iterationExpandedStates[nodeId],
        },
      }));
    },

    // Toggle loop expanded state
    toggleLoopExpanded: (nodeId: string) => {
      set(state => ({
        loopExpandedStates: {
          ...state.loopExpandedStates,
          [nodeId]: !state.loopExpandedStates[nodeId],
        },
      }));
    },

    // Handle SSE events
    handleNodeEvent: (event: ChatflowNodeEvent) => {
      const eventData = (event.data || {}) as ChatflowNodeEventData;
      const { nodes } = get();

      console.log('[ChatflowExecution] Node event received:', event.event);
      console.log('[ChatflowExecution] Node data:', eventData);
      console.log('[ChatflowExecution] Current node count:', nodes.length);

      switch (event.event) {
        case 'node_started':
          // Add or update node to running state
          const { node_id, title, node_type } = eventData;
          const nodeTitle = title || node_type || `Node ${nodes.length + 1}`;
          const { currentIteration } = get();

          // Check if inside an iteration (excluding the iteration container node itself)
          const isInIteration = !!(
            currentIteration &&
            currentIteration.status === 'running' &&
            currentIteration.nodeId !== node_id
          );

          // Check if inside a loop (excluding the loop container node itself)
          const { currentLoop } = get();
          const isInLoop = !!(
            currentLoop &&
            currentLoop.status === 'running' &&
            currentLoop.nodeId !== node_id
          );

          console.log('[ChatflowExecution] node_started:', {
            nodeId: node_id,
            nodeTitle,
            isInLoop,
            currentLoopNodeId: currentLoop?.nodeId,
            isLoopContainer: currentLoop?.nodeId === node_id,
          });

          const existingNodeIndex = nodes.findIndex(n => n.id === node_id);

          if (existingNodeIndex >= 0) {
            // Update existing node
            get().updateNode(node_id, {
              status: 'running',
              startTime: Date.now(),
              description: 'Running...',
              type: node_type,
              isInIteration: isInIteration,
              iterationIndex: isInIteration
                ? currentIteration.index
                : undefined,
              isInLoop: isInLoop,
              loopIndex: isInLoop ? currentLoop.index : undefined,
            });
          } else {
            // Add new node
            get().addNode({
              id: node_id,
              title: nodeTitle,
              status: 'running',
              startTime: Date.now(),
              description: 'Running...',
              type: node_type,
              visible: true,
              isInIteration: isInIteration,
              iterationIndex: isInIteration
                ? currentIteration.index
                : undefined,
              isInLoop: isInLoop,
              loopIndex: isInLoop ? currentLoop.index : undefined,
            });
          }

          get().setCurrentNode(node_id);
          break;

        case 'node_finished':
          // Update node to completed state
          const { node_id: finishedNodeId, status, error } = eventData;
          const nodeStatus = status === 'succeeded' ? 'completed' : 'failed';

          get().updateNode(finishedNodeId, {
            status: nodeStatus,
            endTime: Date.now(),
            description:
              nodeStatus === 'completed'
                ? 'Execution completed'
                : error || 'Execution failed',
          });
          break;

        case 'node_failed':
          // Update node to failed state
          get().updateNode(eventData.node_id, {
            status: 'failed',
            endTime: Date.now(),
            description: eventData.error || 'Execution failed',
          });

          get().setError(eventData.error || 'Node execution failed');
          break;

        case 'workflow_started':
          get().startExecution();
          break;

        case 'workflow_finished':
          set({ isExecuting: false, currentNodeId: null });
          break;

        case 'workflow_interrupted':
          get().stopExecution();
          get().setError('Workflow interrupted');
          break;

        case 'iteration_started':
          const {
            node_id: iterNodeId,
            iteration_id,
            iteration_index,
            title: iterTitle,
            node_type: iterNodeType,
          } = eventData;
          const totalIterations =
            eventData.metadata?.iterator_length ||
            eventData.total_iterations ||
            1;

          // Iteration should start from 0, first iteration_next is round 1
          const initialIndex = 0;

          // Set current iteration state - subsequent nodes will belong to this iteration
          set({
            currentIteration: {
              nodeId: iterNodeId,
              iterationId: iteration_id || `iter-${Date.now()}`,
              index: initialIndex,
              totalIterations: totalIterations,
              startTime: Date.now(),
              status: 'running',
            },
          });

          // Create iteration container node if not exists
          const existingIterNode = nodes.find(n => n.id === iterNodeId);
          if (!existingIterNode) {
            get().addNode({
              id: iterNodeId,
              title: iterTitle || 'Iteration',
              status: 'running',
              startTime: Date.now(),
              description: `Preparing iteration (total ${totalIterations} rounds)`,
              type: iterNodeType || 'iteration',
              visible: true,
              isIterationNode: true,
              totalIterations: totalIterations,
              currentIteration: initialIndex,
            });
          } else {
            // Update existing iteration container
            get().updateNode(iterNodeId, {
              description: `Preparing iteration (total ${totalIterations} rounds)`,
              currentIteration: initialIndex,
              status: 'running',
            });
          }

          // Auto expand iteration node
          set(state => ({
            iterationExpandedStates: {
              ...state.iterationExpandedStates,
              [iterNodeId]: true,
            },
          }));
          break;

        case 'iteration_next':
          const { node_id: nextNodeId, iteration_index: nextIndex } = eventData;
          const { currentIteration: currentIter } = get();

          if (currentIter && currentIter.nodeId === nextNodeId) {
            // Increment from 0: 0->1, 1->2, 2->3
            const newIterationIndex = currentIter.index + 1;

            // Boundary check: prevent exceeding max iterations
            if (newIterationIndex >= currentIter.totalIterations) {
              console.warn(
                '[ChatflowExecution] Extra iteration_next event received, already at max iterations:',
                {
                  currentIndex: currentIter.index,
                  newIndex: newIterationIndex,
                  total: currentIter.totalIterations,
                }
              );
              break; // Ignore extra iteration_next events
            }

            console.log('[ChatflowExecution] Iteration next round:', {
              currentRound: newIterationIndex,
              totalRounds: currentIter.totalIterations,
            });

            // Update current iteration state
            set({
              currentIteration: {
                ...currentIter,
                index: newIterationIndex,
                startTime: Date.now(),
              },
            });

            // Update UI with current round
            get().updateNode(nextNodeId, {
              description: `Round ${newIterationIndex} / Total ${currentIter.totalIterations} rounds`,
              currentIteration: newIterationIndex,
            });

            // Update all child nodes in iteration with round index
            const { nodes } = get();
            nodes.forEach(node => {
              if (node.isInIteration && !node.isIterationNode) {
                get().updateNode(node.id, {
                  iterationIndex: newIterationIndex,
                });
              }
            });
          }
          break;

        case 'iteration_completed':
          const { node_id: completedNodeId } = eventData;
          const { currentIteration: completedIter } = get();

          if (completedIter && completedIter.nodeId === completedNodeId) {
            // Update iteration container node to completed, keep final count
            get().updateNode(completedNodeId, {
              status: 'completed',
              endTime: Date.now(),
              description: `Iteration completed (total ${completedIter.totalIterations} rounds)`,
              // Do not modify currentIteration field to avoid UI double increment
              totalIterations: completedIter.totalIterations,
            });

            // Clear current iteration state
            set({ currentIteration: null });

            // Keep isInIteration flag for child nodes so user can see hierarchy
            // Do not clear isInIteration
          }
          break;

        case 'parallel_branch_started':
          const {
            node_id: branchNodeId,
            branch_id,
            branch_index,
            total_branches,
          } = eventData;

          // Ensure node exists and mark as parallel node
          const branchNode = nodes.find(n => n.id === branchNodeId);
          if (branchNode) {
            get().updateNode(branchNodeId, {
              isParallelNode: true,
              totalBranches: total_branches,
            });
          }

          // Add new parallel branch
          get().addParallelBranch(branchNodeId, {
            id: branch_id,
            index: branch_index,
            status: 'running',
            startTime: Date.now(),
            inputs: eventData.inputs,
            description: `Branch ${branch_index}`,
          });
          break;

        case 'parallel_branch_finished':
          const {
            node_id: finishedBranchNodeId,
            branch_id: finishedBranchId,
            status: branchStatus,
            error: branchError,
          } = eventData;

          // Update branch state
          get().updateParallelBranch(finishedBranchNodeId, finishedBranchId, {
            status: branchStatus === 'succeeded' ? 'completed' : 'failed',
            endTime: Date.now(),
            outputs: eventData.outputs,
            error: branchError,
            description:
              branchStatus === 'succeeded'
                ? 'Branch completed'
                : 'Branch failed',
          });

          // Update completed branch count
          const { nodes: currentNodes } = get();
          const parallelNode = currentNodes.find(
            n => n.id === finishedBranchNodeId
          );
          if (parallelNode && parallelNode.parallelBranches) {
            const completedCount = parallelNode.parallelBranches.filter(
              branch =>
                branch.status === 'completed' || branch.status === 'failed'
            ).length;

            get().updateNode(finishedBranchNodeId, {
              completedBranches: completedCount,
            });

            // If all branches are done, update node status
            if (completedCount === parallelNode.totalBranches) {
              const hasFailedBranches = parallelNode.parallelBranches.some(
                branch => branch.status === 'failed'
              );
              get().updateNode(finishedBranchNodeId, {
                status: hasFailedBranches ? 'failed' : 'completed',
                endTime: Date.now(),
                description: hasFailedBranches
                  ? 'Some branches failed'
                  : 'All branches completed',
              });
            }
          }
          break;

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
          const initialLoopIndex = 0; // Loop starts from 0, same as iteration

          console.log('[ChatflowExecution] Loop started:', {
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

          // Create loop container node if not exists, same logic as iteration
          const existingLoopNode = nodes.find(n => n.id === loopNodeId);
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
          // Handle next loop event, increment logic same as iteration_next
          const { node_id: nextLoopNodeId, index: nextLoopIndex } = eventData;
          const { currentLoop: currentLoopState } = get();

          if (currentLoopState && currentLoopState.nodeId === nextLoopNodeId) {
            // Use same increment logic as iteration, not direct event data
            const newLoopIndex = currentLoopState.index + 1;

            // Boundary check: prevent exceeding max loop count
            if (
              currentLoopState.maxLoops &&
              newLoopIndex >= currentLoopState.maxLoops
            ) {
              console.warn(
                '[ChatflowExecution] Extra loop_next event received, already at max loop count:',
                {
                  currentIndex: currentLoopState.index,
                  newIndex: newLoopIndex,
                  max: currentLoopState.maxLoops,
                }
              );
              break; // Ignore extra loop_next events
            }

            console.log('[ChatflowExecution] Loop next round:', {
              currentRound: newLoopIndex,
              maxRounds: currentLoopState.maxLoops,
            });

            // Update current loop state
            set({
              currentLoop: {
                ...currentLoopState,
                index: newLoopIndex,
                startTime: Date.now(),
              },
            });

            // Update loop container node display
            const maxLoopsText = currentLoopState.maxLoops
              ? ` / Max ${currentLoopState.maxLoops} times`
              : '';
            get().updateNode(nextLoopNodeId, {
              description: `Round ${newLoopIndex} loop${maxLoopsText}`,
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
            // Infer total loop count from outputs or use current loop state
            const finalLoopCount =
              loopOutputs?.loop_round ||
              completedLoopState.index + 1 ||
              completedLoopState.maxLoops ||
              0;

            // Update loop container node to completed
            get().updateNode(completedLoopNodeId, {
              status: 'completed',
              endTime: Date.now(),
              description: `Loop completed (executed ${finalLoopCount} times)`,
              // Do not modify currentLoop field to avoid UI double increment
              totalLoops: finalLoopCount,
            });

            // Clear current loop state
            set({ currentLoop: null });

            // Keep isInLoop flag for child nodes so user can see hierarchy
            // Do not clear isInLoop
          }
          break;

        default:
          console.log('[ChatflowExecution] Unknown event type:', event.event);
          break;
      }
    },
  })
);
