export const MESSAGES_PER_PAGE = 20;

export type LoadingState =
  'idle' | 'loading' | 'success' | 'error' | 'complete';

export type LoadingStatus = {
  state: LoadingState;
  type: 'initial' | 'more' | 'none';
  isLocked: boolean;
};

export type ConversationLoaderState = {
  page: number;
  currentId: string | null;
  totalMessages: number;
  nextCursor: string | null;
  abortController: AbortController | null;
  previousPath: string | null;
};

export function createIdleLoadingStatus(): LoadingStatus {
  return {
    state: 'idle',
    type: 'none',
    isLocked: false,
  };
}

export function createConversationLoaderState(): ConversationLoaderState {
  return {
    page: 1,
    currentId: null,
    totalMessages: 0,
    nextCursor: null,
    abortController: null,
    previousPath: null,
  };
}
