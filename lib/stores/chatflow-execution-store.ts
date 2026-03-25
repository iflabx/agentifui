import { create } from 'zustand';

import { handleChatflowNodeEvent } from './chatflow-execution-store/event-handler';
import {
  addChatflowIteration,
  addChatflowLoop,
  addChatflowParallelBranch,
  appendChatflowNode,
  calculateChatflowExecutionProgress,
  markRunningChatflowNodesStopped,
  removeChatflowIteration,
  removeChatflowLoop,
  removeChatflowParallelBranch,
  updateChatflowIteration,
  updateChatflowLoop,
  updateChatflowNodeCollection,
  updateChatflowParallelBranch,
} from './chatflow-execution-store/node-helpers';
import {
  createChatflowExecutionBaseState,
  createChatflowExecutionResetState,
  createChatflowExecutionStartState,
} from './chatflow-execution-store/state';
export type {
  ChatflowExecutionProgress,
  ChatflowExecutionState,
  ChatflowIteration,
  ChatflowLoop,
  ChatflowNode,
  ChatflowNodeEvent,
  ChatflowParallelBranch,
} from './chatflow-execution-store/types';
import type {
  ChatflowExecutionState,
  ChatflowIteration,
  ChatflowLoop,
  ChatflowNode,
  ChatflowNodeEvent,
  ChatflowParallelBranch,
} from './chatflow-execution-store/types';

export const useChatflowExecutionStore = create<ChatflowExecutionState>(
  (set, get) => ({
    ...createChatflowExecutionBaseState(),

    startExecution: () => {
      console.log('[ChatflowExecution] Execution started');
      set(createChatflowExecutionStartState());
    },

    stopExecution: () => {
      set(state => ({
        isExecuting: false,
        nodes: markRunningChatflowNodesStopped(state.nodes),
        currentNodeId: null,
        canRetry: true,
      }));
    },

    resetExecution: () => {
      set(createChatflowExecutionResetState());
    },

    addNode: (node: ChatflowNode) => {
      set(state => ({
        nodes: appendChatflowNode(state.nodes, node),
      }));
    },

    updateNode: (nodeId: string, updates: Partial<ChatflowNode>) => {
      set(state => ({
        nodes: updateChatflowNodeCollection(state.nodes, nodeId, updates),
      }));

      set({ executionProgress: calculateChatflowExecutionProgress(get().nodes) });
    },

    setCurrentNode: (nodeId: string | null) => {
      set({ currentNodeId: nodeId });
    },

    addIteration: (nodeId: string, iteration: ChatflowIteration) => {
      set(state => ({
        nodes: addChatflowIteration(state.nodes, nodeId, iteration),
      }));
    },

    updateIteration: (
      nodeId: string,
      iterationId: string,
      updates: Partial<ChatflowIteration>
    ) => {
      set(state => ({
        nodes: updateChatflowIteration(state.nodes, nodeId, iterationId, updates),
      }));
    },

    completeIteration: (nodeId: string, iterationId: string) => {
      set(state => ({
        nodes: removeChatflowIteration(state.nodes, nodeId, iterationId),
      }));
    },

    addParallelBranch: (nodeId: string, branch: ChatflowParallelBranch) => {
      set(state => ({
        nodes: addChatflowParallelBranch(state.nodes, nodeId, branch),
      }));
    },

    updateParallelBranch: (
      nodeId: string,
      branchId: string,
      updates: Partial<ChatflowParallelBranch>
    ) => {
      set(state => ({
        nodes: updateChatflowParallelBranch(
          state.nodes,
          nodeId,
          branchId,
          updates
        ),
      }));
    },

    completeParallelBranch: (
      nodeId: string,
      branchId: string,
      _status: 'completed' | 'failed'
    ) => {
      set(state => ({
        nodes: removeChatflowParallelBranch(state.nodes, nodeId, branchId),
      }));
    },

    addLoop: (nodeId: string, loop: ChatflowLoop) => {
      set(state => ({
        nodes: addChatflowLoop(state.nodes, nodeId, loop),
      }));
    },

    updateLoop: (
      nodeId: string,
      loopId: string,
      updates: Partial<ChatflowLoop>
    ) => {
      set(state => ({
        nodes: updateChatflowLoop(state.nodes, nodeId, loopId, updates),
      }));
    },

    completeLoop: (nodeId: string, loopId: string) => {
      set(state => ({
        nodes: removeChatflowLoop(state.nodes, nodeId, loopId),
      }));
    },

    setError: (error: string | null) => {
      set({ error, canRetry: !!error });
    },

    setCanRetry: (canRetry: boolean) => {
      set({ canRetry });
    },

    toggleIterationExpanded: (nodeId: string) => {
      set(state => ({
        iterationExpandedStates: {
          ...state.iterationExpandedStates,
          [nodeId]: !state.iterationExpandedStates[nodeId],
        },
      }));
    },

    toggleLoopExpanded: (nodeId: string) => {
      set(state => ({
        loopExpandedStates: {
          ...state.loopExpandedStates,
          [nodeId]: !state.loopExpandedStates[nodeId],
        },
      }));
    },

    handleNodeEvent: (event: ChatflowNodeEvent) => {
      handleChatflowNodeEvent(event, {
        getState: get,
        setState: set,
        addNode: get().addNode,
        updateNode: get().updateNode,
        setCurrentNode: get().setCurrentNode,
        addParallelBranch: get().addParallelBranch,
        updateParallelBranch: get().updateParallelBranch,
        startExecution: get().startExecution,
        stopExecution: get().stopExecution,
        setError: get().setError,
      });
    },
  })
);
