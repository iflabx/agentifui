import type {
  WorkflowExecutionEvent,
  WorkflowExecutionEventData,
  WorkflowExecutionState,
  WorkflowNode,
} from './types';

type WorkflowStoreContext = {
  getState: () => WorkflowExecutionState;
  setState: (
    updater:
      | Partial<WorkflowExecutionState>
      | ((state: WorkflowExecutionState) => Partial<WorkflowExecutionState>)
  ) => void;
  addNode: (node: WorkflowNode) => void;
  updateNode: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  onNodeStarted: (nodeId: string, title: string, description: string) => void;
  onNodeFinished: (nodeId: string, success: boolean, error?: string) => void;
  addParallelBranch: (
    nodeId: string,
    branch: WorkflowExecutionState['addParallelBranch'] extends (
      nodeId: string,
      branch: infer T
    ) => void
      ? T
      : never
  ) => void;
  completeParallelBranch: WorkflowExecutionState['completeParallelBranch'];
  startExecution: WorkflowExecutionState['startExecution'];
  stopExecution: WorkflowExecutionState['stopExecution'];
  setError: WorkflowExecutionState['setError'];
};

export function handleWorkflowExecutionNodeEvent(
  event: WorkflowExecutionEvent,
  context: WorkflowStoreContext
): void {
  const eventData = (event.data || {}) as WorkflowExecutionEventData;
  console.log('[WorkflowStore] Handle node event:', event.event, eventData);

  switch (event.event) {
    case 'node_started': {
      const { node_id, node_type, title } = eventData;
      const { currentIteration, currentLoop } = context.getState();
      const isInIteration = Boolean(
        currentIteration &&
          currentIteration.status === 'running' &&
          currentIteration.nodeId !== node_id
      );
      const isInLoop = Boolean(
        currentLoop &&
          currentLoop.status === 'running' &&
          currentLoop.nodeId !== node_id
      );

      if (isInIteration || isInLoop) {
        const existingNode = context
          .getState()
          .nodes.find(node => node.id === node_id);
        if (existingNode) {
          context.updateNode(node_id, {
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
          context.addNode({
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
        context.onNodeStarted(node_id, title || `${node_type} node`, 'Started');
      }
      break;
    }

    case 'node_finished': {
      const { node_id: finishedNodeId, status, error } = eventData;
      context.onNodeFinished(finishedNodeId, status === 'succeeded', error);
      break;
    }

    case 'iteration_started': {
      const {
        node_id: iterNodeId,
        iteration_id,
        title: iterTitle,
        node_type: iterNodeType,
      } = eventData;
      const totalIterations =
        eventData.metadata?.iterator_length || eventData.total_iterations || 1;

      const existingNode = context
        .getState()
        .nodes.find(node => node.id === iterNodeId);

      if (!existingNode) {
        context.addNode({
          id: iterNodeId,
          title: iterTitle || 'Iteration',
          type: iterNodeType || 'iteration',
          status: 'running',
          startTime: Date.now(),
          description: `Preparing iteration (total ${totalIterations} rounds)`,
          visible: true,
          isIterationNode: true,
          totalIterations,
          currentIteration: 0,
          iterations: [],
        });
      } else {
        context.updateNode(iterNodeId, {
          isIterationNode: true,
          totalIterations,
          currentIteration: 0,
          status: 'running',
          description: `Preparing iteration (total ${totalIterations} rounds)`,
        });
      }

      context.setState(state => ({
        currentIteration: {
          nodeId: iterNodeId,
          iterationId: iteration_id || `iter-${Date.now()}`,
          index: 0,
          totalIterations,
          startTime: Date.now(),
          status: 'running',
        },
        iterationExpandedStates: {
          ...state.iterationExpandedStates,
          [iterNodeId]: true,
        },
      }));
      break;
    }

    case 'iteration_next': {
      const { node_id: nextNodeId } = eventData;
      const { currentIteration, nodes } = context.getState();
      if (currentIteration && currentIteration.nodeId === nextNodeId) {
        const newIndex = currentIteration.index + 1;
        if (newIndex >= currentIteration.totalIterations) {
          break;
        }

        context.updateNode(nextNodeId, {
          currentIteration: newIndex,
          description: `Round ${newIndex + 1} / Total ${currentIteration.totalIterations} rounds`,
        });
        context.setState({
          currentIteration: {
            ...currentIteration,
            index: newIndex,
            startTime: Date.now(),
          },
        });
        nodes.forEach(node => {
          if (node.isInIteration && !node.isIterationNode) {
            context.updateNode(node.id, { iterationIndex: newIndex });
          }
        });
      }
      break;
    }

    case 'iteration_completed':
      context.updateNode(eventData.node_id, {
        status: 'completed',
        endTime: Date.now(),
        description: 'Iteration completed',
      });
      context.setState({ currentIteration: null });
      break;

    case 'loop_started': {
      const {
        id: loopId,
        node_id: loopNodeId,
        title: loopTitle,
        node_type: loopNodeType,
        metadata: loopMetadata,
        inputs: loopInputs,
      } = eventData;
      const maxLoops =
        loopMetadata?.loop_length || loopInputs?.loop_count || undefined;
      const existingLoopNode = context
        .getState()
        .nodes.find(node => node.id === loopNodeId);

      context.setState(state => ({
        currentLoop: {
          nodeId: loopNodeId,
          loopId,
          index: 0,
          maxLoops,
          startTime: Date.now(),
          status: 'running',
        },
        loopExpandedStates: {
          ...state.loopExpandedStates,
          [loopNodeId]: true,
        },
      }));

      if (!existingLoopNode) {
        context.addNode({
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
          maxLoops,
          currentLoop: 0,
        });
      } else {
        context.updateNode(loopNodeId, {
          description: maxLoops
            ? `Preparing loop (max ${maxLoops} times)`
            : 'Preparing loop',
          currentLoop: 0,
          status: 'running',
        });
      }
      break;
    }

    case 'loop_next': {
      const { node_id: nextLoopNodeId } = eventData;
      const { currentLoop, nodes } = context.getState();

      if (currentLoop && currentLoop.nodeId === nextLoopNodeId) {
        const newLoopIndex = currentLoop.index + 1;
        if (currentLoop.maxLoops && newLoopIndex >= currentLoop.maxLoops) {
          break;
        }

        context.setState({
          currentLoop: {
            ...currentLoop,
            index: newLoopIndex,
            startTime: Date.now(),
          },
        });

        const maxLoopsText = currentLoop.maxLoops
          ? ` / max ${currentLoop.maxLoops} times`
          : '';
        context.updateNode(nextLoopNodeId, {
          description: `Round ${newLoopIndex + 1} loop${maxLoopsText}`,
          currentLoop: newLoopIndex,
        });

        nodes.forEach(node => {
          if (node.isInLoop && !node.isLoopNode) {
            context.updateNode(node.id, { loopIndex: newLoopIndex });
          }
        });
      }
      break;
    }

    case 'loop_completed': {
      const { node_id: completedLoopNodeId, outputs: loopOutputs } = eventData;
      const { currentLoop } = context.getState();

      if (currentLoop && currentLoop.nodeId === completedLoopNodeId) {
        const finalLoopCount =
          loopOutputs?.loop_round ||
          currentLoop.index + 1 ||
          currentLoop.maxLoops ||
          0;

        context.updateNode(completedLoopNodeId, {
          status: 'completed',
          endTime: Date.now(),
          description: `Loop completed (executed ${finalLoopCount} times)`,
          totalLoops: finalLoopCount,
        });

        context.setState({ currentLoop: null });
      }
      break;
    }

    case 'parallel_branch_started': {
      const {
        node_id: parallelNodeId,
        parallel_id,
        parallel_run_id,
      } = eventData;
      const existingParallelNode = context
        .getState()
        .nodes.find(node => node.id === parallelNodeId);
      if (!existingParallelNode) {
        context.addNode({
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

      context.addParallelBranch(parallelNodeId, {
        id: parallel_run_id,
        name: `Branch ${parallel_id}`,
        status: 'running',
        startTime: Date.now(),
      });
      break;
    }

    case 'parallel_branch_finished': {
      const {
        node_id: finishedParallelNodeId,
        parallel_run_id: finishedRunId,
        status: branchStatus,
      } = eventData;

      context.completeParallelBranch(
        finishedParallelNodeId,
        finishedRunId,
        branchStatus === 'succeeded' ? 'completed' : 'failed'
      );

      const parallelNode = context
        .getState()
        .nodes.find(node => node.id === finishedParallelNodeId);
      if (parallelNode) {
        const completedCount = (parallelNode.parallelBranches || []).filter(
          branch => branch.status === 'completed' || branch.status === 'failed'
        ).length;

        context.updateNode(finishedParallelNodeId, {
          completedBranches: completedCount,
        });

        if (completedCount === parallelNode.totalBranches) {
          context.updateNode(finishedParallelNodeId, {
            status: 'completed',
            endTime: Date.now(),
            description: 'Parallel execution completed',
          });
        }
      }
      break;
    }

    case 'workflow_started':
      context.startExecution(context.getState().formData);
      break;

    case 'workflow_finished':
      context.setState({ isExecuting: false, currentNodeId: null });
      break;

    case 'workflow_interrupted':
      context.stopExecution();
      context.setError('Workflow interrupted');
      break;

    default:
      console.log('[WorkflowStore] Unhandled event type:', event.event);
  }
}
