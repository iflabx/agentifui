import type {
  ChatflowExecutionState,
  ChatflowNode,
  ChatflowNodeEvent,
  ChatflowNodeEventData,
} from './types';

type ChatflowStoreContext = {
  getState: () => ChatflowExecutionState;
  setState: (
    updater:
      | Partial<ChatflowExecutionState>
      | ((state: ChatflowExecutionState) => Partial<ChatflowExecutionState>)
  ) => void;
  addNode: ChatflowExecutionState['addNode'];
  updateNode: ChatflowExecutionState['updateNode'];
  setCurrentNode: ChatflowExecutionState['setCurrentNode'];
  addParallelBranch: ChatflowExecutionState['addParallelBranch'];
  updateParallelBranch: ChatflowExecutionState['updateParallelBranch'];
  startExecution: ChatflowExecutionState['startExecution'];
  stopExecution: ChatflowExecutionState['stopExecution'];
  setError: ChatflowExecutionState['setError'];
};

function buildStartedChatflowNode(
  nodeId: string,
  nodeTitle: string,
  nodeType: string,
  isInIteration: boolean,
  iterationIndex: number | undefined,
  isInLoop: boolean,
  loopIndex: number | undefined
): ChatflowNode {
  return {
    id: nodeId,
    title: nodeTitle,
    status: 'running',
    startTime: Date.now(),
    description: 'Running...',
    type: nodeType,
    visible: true,
    isInIteration,
    iterationIndex,
    isInLoop,
    loopIndex,
  };
}

export function handleChatflowNodeEvent(
  event: ChatflowNodeEvent,
  context: ChatflowStoreContext
): void {
  const eventData = (event.data || {}) as ChatflowNodeEventData;
  const { nodes } = context.getState();

  console.log('[ChatflowExecution] Node event received:', event.event);
  console.log('[ChatflowExecution] Node data:', eventData);
  console.log('[ChatflowExecution] Current node count:', nodes.length);

  switch (event.event) {
    case 'node_started': {
      const { node_id, title, node_type } = eventData;
      const nodeTitle = title || node_type || `Node ${nodes.length + 1}`;
      const { currentIteration, currentLoop } = context.getState();
      const isInIteration = Boolean(
        currentIteration &&
          currentIteration.status === 'running' &&
          currentIteration.nodeId !== node_id
      );
      const isInLoop = Boolean(
        currentLoop && currentLoop.status === 'running' && currentLoop.nodeId !== node_id
      );

      console.log('[ChatflowExecution] node_started:', {
        nodeId: node_id,
        nodeTitle,
        isInLoop,
        currentLoopNodeId: currentLoop?.nodeId,
        isLoopContainer: currentLoop?.nodeId === node_id,
      });

      const existingNode = context.getState().nodes.find(node => node.id === node_id);
      if (existingNode) {
        context.updateNode(node_id, {
          status: 'running',
          startTime: Date.now(),
          description: 'Running...',
          type: node_type,
          isInIteration,
          iterationIndex: isInIteration ? currentIteration?.index : undefined,
          isInLoop,
          loopIndex: isInLoop ? currentLoop?.index : undefined,
        });
      } else {
        context.addNode(
          buildStartedChatflowNode(
            node_id,
            nodeTitle,
            node_type,
            isInIteration,
            isInIteration ? currentIteration?.index : undefined,
            isInLoop,
            isInLoop ? currentLoop?.index : undefined
          )
        );
      }

      context.setCurrentNode(node_id);
      break;
    }

    case 'node_finished': {
      const { node_id: finishedNodeId, status, error } = eventData;
      const nodeStatus = status === 'succeeded' ? 'completed' : 'failed';
      context.updateNode(finishedNodeId, {
        status: nodeStatus,
        endTime: Date.now(),
        description:
          nodeStatus === 'completed' ? 'Execution completed' : error || 'Execution failed',
      });
      break;
    }

    case 'node_failed':
      context.updateNode(eventData.node_id, {
        status: 'failed',
        endTime: Date.now(),
        description: eventData.error || 'Execution failed',
      });
      context.setError(eventData.error || 'Node execution failed');
      break;

    case 'workflow_started':
      context.startExecution();
      break;

    case 'workflow_finished':
      context.setState({ isExecuting: false, currentNodeId: null });
      break;

    case 'workflow_interrupted':
      context.stopExecution();
      context.setError('Workflow interrupted');
      break;

    case 'iteration_started': {
      const { node_id: iterNodeId, iteration_id, title: iterTitle, node_type: iterNodeType } =
        eventData;
      const totalIterations =
        eventData.metadata?.iterator_length || eventData.total_iterations || 1;
      const initialIndex = 0;

      context.setState({
        currentIteration: {
          nodeId: iterNodeId,
          iterationId: iteration_id || `iter-${Date.now()}`,
          index: initialIndex,
          totalIterations,
          startTime: Date.now(),
          status: 'running',
        },
      });

      const existingIterNode = context.getState().nodes.find(node => node.id === iterNodeId);
      if (!existingIterNode) {
        context.addNode({
          id: iterNodeId,
          title: iterTitle || 'Iteration',
          status: 'running',
          startTime: Date.now(),
          description: `Preparing iteration (total ${totalIterations} rounds)`,
          type: iterNodeType || 'iteration',
          visible: true,
          isIterationNode: true,
          totalIterations,
          currentIteration: initialIndex,
        });
      } else {
        context.updateNode(iterNodeId, {
          description: `Preparing iteration (total ${totalIterations} rounds)`,
          currentIteration: initialIndex,
          status: 'running',
        });
      }

      context.setState(state => ({
        iterationExpandedStates: {
          ...state.iterationExpandedStates,
          [iterNodeId]: true,
        },
      }));
      break;
    }

    case 'iteration_next': {
      const { node_id: nextNodeId } = eventData;
      const { currentIteration } = context.getState();
      if (currentIteration && currentIteration.nodeId === nextNodeId) {
        const newIterationIndex = currentIteration.index + 1;
        if (newIterationIndex >= currentIteration.totalIterations) {
          console.warn(
            '[ChatflowExecution] Extra iteration_next event received, already at max iterations:',
            {
              currentIndex: currentIteration.index,
              newIndex: newIterationIndex,
              total: currentIteration.totalIterations,
            }
          );
          break;
        }

        console.log('[ChatflowExecution] Iteration next round:', {
          currentRound: newIterationIndex,
          totalRounds: currentIteration.totalIterations,
        });

        context.setState({
          currentIteration: {
            ...currentIteration,
            index: newIterationIndex,
            startTime: Date.now(),
          },
        });

        context.updateNode(nextNodeId, {
          description: `Round ${newIterationIndex} / Total ${currentIteration.totalIterations} rounds`,
          currentIteration: newIterationIndex,
        });

        context.getState().nodes.forEach(node => {
          if (node.isInIteration && !node.isIterationNode) {
            context.updateNode(node.id, { iterationIndex: newIterationIndex });
          }
        });
      }
      break;
    }

    case 'iteration_completed': {
      const { node_id: completedNodeId } = eventData;
      const { currentIteration } = context.getState();
      if (currentIteration && currentIteration.nodeId === completedNodeId) {
        context.updateNode(completedNodeId, {
          status: 'completed',
          endTime: Date.now(),
          description: `Iteration completed (total ${currentIteration.totalIterations} rounds)`,
          totalIterations: currentIteration.totalIterations,
        });
        context.setState({ currentIteration: null });
      }
      break;
    }

    case 'parallel_branch_started': {
      const { node_id: branchNodeId, branch_id, branch_index, total_branches } = eventData;
      const branchNode = context.getState().nodes.find(node => node.id === branchNodeId);
      if (branchNode) {
        context.updateNode(branchNodeId, {
          isParallelNode: true,
          totalBranches: total_branches,
        });
      }

      context.addParallelBranch(branchNodeId, {
        id: branch_id,
        index: branch_index,
        status: 'running',
        startTime: Date.now(),
        inputs: eventData.inputs,
        description: `Branch ${branch_index}`,
      });
      break;
    }

    case 'parallel_branch_finished': {
      const {
        node_id: finishedBranchNodeId,
        branch_id: finishedBranchId,
        status: branchStatus,
        error: branchError,
      } = eventData;

      context.updateParallelBranch(finishedBranchNodeId, finishedBranchId, {
        status: branchStatus === 'succeeded' ? 'completed' : 'failed',
        endTime: Date.now(),
        outputs: eventData.outputs,
        error: branchError,
        description: branchStatus === 'succeeded' ? 'Branch completed' : 'Branch failed',
      });

      const parallelNode = context.getState().nodes.find(node => node.id === finishedBranchNodeId);
      if (parallelNode && parallelNode.parallelBranches) {
        const completedCount = parallelNode.parallelBranches.filter(
          branch => branch.status === 'completed' || branch.status === 'failed'
        ).length;

        context.updateNode(finishedBranchNodeId, {
          completedBranches: completedCount,
        });

        if (completedCount === parallelNode.totalBranches) {
          const hasFailedBranches = parallelNode.parallelBranches.some(
            branch => branch.status === 'failed'
          );
          context.updateNode(finishedBranchNodeId, {
            status: hasFailedBranches ? 'failed' : 'completed',
            endTime: Date.now(),
            description: hasFailedBranches ? 'Some branches failed' : 'All branches completed',
          });
        }
      }
      break;
    }

    case 'loop_started': {
      const { id: loopId, node_id: loopNodeId, title: loopTitle, node_type: loopNodeType } =
        eventData;
      const maxLoops = eventData.metadata?.loop_length || eventData.inputs?.loop_count || undefined;
      const initialLoopIndex = 0;

      console.log('[ChatflowExecution] Loop started:', {
        loopNodeId,
        loopTitle,
        maxLoops,
        loopMetadata: eventData.metadata,
        loopInputs: eventData.inputs,
      });

      context.setState({
        currentLoop: {
          nodeId: loopNodeId,
          loopId,
          index: initialLoopIndex,
          maxLoops,
          startTime: Date.now(),
          status: 'running',
        },
      });

      const existingLoopNode = context.getState().nodes.find(node => node.id === loopNodeId);
      if (!existingLoopNode) {
        context.addNode({
          id: loopNodeId,
          title: loopTitle || 'Loop',
          status: 'running',
          startTime: Date.now(),
          description: maxLoops ? `Preparing loop (max ${maxLoops} times)` : 'Preparing loop',
          type: loopNodeType || 'loop',
          visible: true,
          isLoopNode: true,
          maxLoops,
          currentLoop: initialLoopIndex,
        });
      } else {
        context.updateNode(loopNodeId, {
          description: maxLoops ? `Preparing loop (max ${maxLoops} times)` : 'Preparing loop',
          currentLoop: initialLoopIndex,
          status: 'running',
        });
      }

      context.setState(state => ({
        loopExpandedStates: {
          ...state.loopExpandedStates,
          [loopNodeId]: true,
        },
      }));
      break;
    }

    case 'loop_next': {
      const { node_id: nextLoopNodeId } = eventData;
      const { currentLoop } = context.getState();
      if (currentLoop && currentLoop.nodeId === nextLoopNodeId) {
        const newLoopIndex = currentLoop.index + 1;
        if (currentLoop.maxLoops && newLoopIndex >= currentLoop.maxLoops) {
          console.warn(
            '[ChatflowExecution] Extra loop_next event received, already at max loop count:',
            {
              currentIndex: currentLoop.index,
              newIndex: newLoopIndex,
              max: currentLoop.maxLoops,
            }
          );
          break;
        }

        console.log('[ChatflowExecution] Loop next round:', {
          currentRound: newLoopIndex,
          maxRounds: currentLoop.maxLoops,
        });

        context.setState({
          currentLoop: {
            ...currentLoop,
            index: newLoopIndex,
            startTime: Date.now(),
          },
        });

        const maxLoopsText = currentLoop.maxLoops
          ? ` / Max ${currentLoop.maxLoops} times`
          : '';
        context.updateNode(nextLoopNodeId, {
          description: `Round ${newLoopIndex} loop${maxLoopsText}`,
          currentLoop: newLoopIndex,
        });

        context.getState().nodes.forEach(node => {
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
          loopOutputs?.loop_round || currentLoop.index + 1 || currentLoop.maxLoops || 0;

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

    default:
      console.log('[ChatflowExecution] Unknown event type:', event.event);
      break;
  }
}
