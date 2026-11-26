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
  | 'view'
  | 'processMessageId'
  | 'openProcessMessageId'
  | 'nodes'
  | 'currentNodeId'
  | 'isExecuting'
  | 'currentIteration'
  | 'currentLoop'
  | 'iterationExpandedStates'
  | 'loopExpandedStates'
  | 'executionProgress'
  | 'error'
  | 'wasStopped'
  | 'canRetry'
> {
  return {
    view: null,
    processMessageId: null,
    openProcessMessageId: null,
    nodes: [],
    currentNodeId: null,
    isExecuting: false,
    currentIteration: null,
    currentLoop: null,
    iterationExpandedStates: {},
    loopExpandedStates: {},
    executionProgress: { ...CHATFLOW_EMPTY_PROGRESS },
    error: null,
    wasStopped: false,
    canRetry: false,
  };
}

export function createChatflowExecutionStartState(): Partial<ChatflowExecutionState> {
  return {
    isExecuting: true,
    processMessageId: null,
    iterationExpandedStates: {},
    loopExpandedStates: {},
    error: null,
    canRetry: false,
    nodes: [],
    currentNodeId: null,
    executionProgress: { ...CHATFLOW_EMPTY_PROGRESS },
    wasStopped: false,
  };
}

export function createChatflowExecutionResetState(): Partial<ChatflowExecutionState> {
  return {
    view: null,
    processMessageId: null,
    openProcessMessageId: null,
    nodes: [],
    currentNodeId: null,
    isExecuting: false,
    executionProgress: { ...CHATFLOW_EMPTY_PROGRESS },
    error: null,
    wasStopped: false,
    canRetry: false,
  };
}
