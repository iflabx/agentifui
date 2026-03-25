import type {
  ChatflowExecutionProgress,
  ChatflowExecutionState,
} from './types';

export const CHATFLOW_EMPTY_PROGRESS: ChatflowExecutionProgress = {
  current: 0,
  total: 0,
  percentage: 0,
};

export function createChatflowExecutionBaseState(): Pick<
  ChatflowExecutionState,
  | 'nodes'
  | 'currentNodeId'
  | 'isExecuting'
  | 'currentIteration'
  | 'currentLoop'
  | 'iterationExpandedStates'
  | 'loopExpandedStates'
  | 'executionProgress'
  | 'error'
  | 'canRetry'
> {
  return {
    nodes: [],
    currentNodeId: null,
    isExecuting: false,
    currentIteration: null,
    currentLoop: null,
    iterationExpandedStates: {},
    loopExpandedStates: {},
    executionProgress: { ...CHATFLOW_EMPTY_PROGRESS },
    error: null,
    canRetry: false,
  };
}

export function createChatflowExecutionStartState(): Partial<ChatflowExecutionState> {
  return {
    isExecuting: true,
    error: null,
    canRetry: false,
    nodes: [],
    currentNodeId: null,
    executionProgress: { ...CHATFLOW_EMPTY_PROGRESS },
  };
}

export function createChatflowExecutionResetState(): Partial<ChatflowExecutionState> {
  return {
    nodes: [],
    currentNodeId: null,
    isExecuting: false,
    executionProgress: { ...CHATFLOW_EMPTY_PROGRESS },
    error: null,
    canRetry: false,
  };
}
