import { act, renderHook } from '@testing-library/react';

import { runStreamingStateConsistencyCheck } from './streaming-check';
import { useChatStreamingState } from './streaming-state';

jest.mock('./streaming-check', () => ({
  runStreamingStateConsistencyCheck: jest.fn(),
}));

describe('useChatStreamingState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('flushes buffered chunks and clears the append timer', () => {
    const appendMessageChunk = jest.fn();
    const { result } = renderHook(() =>
      useChatStreamingState({
        appendMessageChunk,
        finalizeStreamingMessage: jest.fn(),
        setIsWaitingForResponse: jest.fn(),
        setCurrentTaskId: jest.fn(),
        dbConversationUUID: 'db-1',
        updateMessage: jest.fn(),
        saveMessage: jest.fn(),
      })
    );

    act(() => {
      result.current.chunkBufferRef.current = 'hello';
      result.current.appendTimerRef.current = setTimeout(() => undefined, 1000);
      result.current.flushChunkBuffer('msg-1');
    });

    expect(appendMessageChunk).toHaveBeenCalledWith('msg-1', 'hello');
    expect(result.current.chunkBufferRef.current).toBe('');
    expect(result.current.appendTimerRef.current).toBeNull();
  });

  it('runs the periodic zombie-streaming consistency check', () => {
    const finalizeStreamingMessage = jest.fn();
    const setIsWaitingForResponse = jest.fn();
    const setCurrentTaskId = jest.fn();
    const updateMessage = jest.fn();
    const saveMessage = jest.fn();

    renderHook(() =>
      useChatStreamingState({
        appendMessageChunk: jest.fn(),
        finalizeStreamingMessage,
        setIsWaitingForResponse,
        setCurrentTaskId,
        dbConversationUUID: 'db-2',
        updateMessage,
        saveMessage,
      })
    );

    act(() => {
      jest.advanceTimersByTime(10000);
    });

    expect(runStreamingStateConsistencyCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        dbConversationUUID: 'db-2',
        finalizeStreamingMessage,
        setIsWaitingForResponse,
        setCurrentTaskId,
        updateMessage,
        saveMessage,
      })
    );
  });
});
