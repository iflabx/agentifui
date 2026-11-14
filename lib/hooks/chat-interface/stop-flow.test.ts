import { stopDifyStreamingTask } from '@lib/services/dify/chat-service';
import { useChatStore } from '@lib/stores/chat-store';

import { executeChatStop, persistStoppedStreamingState } from './stop-flow';
import { chatSubmissionOwners } from './submission-owner';

jest.mock('@lib/services/dify/chat-service', () => ({
  stopDifyStreamingTask: jest.fn(),
}));

function stopInput() {
  return {
    currentUserId: 'user-A',
    currentAppId: 'app-A',
    currentAppInstance: { instance_id: 'app-A' } as never,
    dbConversationUUID: 'db-A',
    difyConversationId: 'external-A',
    isSubmittingRef: { current: true },
    appendTimerRef: { current: null },
    setDbConversationUUID: jest.fn(),
    setCurrentTaskId: useChatStore.getState().setCurrentTaskId,
    setIsWaitingForResponse: useChatStore.getState().setIsWaitingForResponse,
    markAsManuallyStopped: useChatStore.getState().markAsManuallyStopped,
    flushChunkBuffer: jest.fn(),
    updateMessage: useChatStore.getState().updateMessage,
    saveMessage: jest.fn().mockResolvedValue(true),
    saveStoppedAssistantMessage: jest.fn().mockResolvedValue(true),
    finalizeStreamingMessage: useChatStore.getState().finalizeStreamingMessage,
  };
}

describe('persistStoppedStreamingState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useChatStore.setState({
      messages: [],
      streamingMessageId: null,
      isWaitingForResponse: false,
      currentConversationId: null,
      currentTaskId: null,
    });
  });

  it('stops an accepted task before the first assistant row', async () => {
    jest.mocked(stopDifyStreamingTask).mockResolvedValue({ result: 'success' });
    useChatStore.setState({
      currentTaskId: 'task-A',
      isWaitingForResponse: true,
    });
    const result = await executeChatStop(stopInput());
    expect(stopDifyStreamingTask).toHaveBeenCalledWith(
      'app-A',
      'task-A',
      'user-A'
    );
    expect(useChatStore.getState().currentTaskId).toBeNull();
    expect(result).toEqual({
      confirmed: true,
      current: true,
      taskId: 'task-A',
    });
  });

  it('does not let a different current app disable cancellation of the captured app', async () => {
    jest.mocked(stopDifyStreamingTask).mockResolvedValue({ result: 'success' });
    useChatStore.setState({
      currentTaskId: 'task-A',
      isWaitingForResponse: true,
    });
    const input = stopInput();
    input.currentAppInstance = {
      instance_id: 'app-B',
      descriptor: { effectiveActions: { cancellation: false } },
    } as never;
    chatSubmissionOwners.set(input.isSubmittingRef, {
      appConfig: {
        appId: 'app-A',
        instance: { instance_id: 'app-A' } as never,
      },
      isCurrent: () => true,
      onStopped: jest.fn(),
    });
    expect(await executeChatStop(input)).toEqual({
      confirmed: true,
      current: true,
      taskId: 'task-A',
    });
    expect(stopDifyStreamingTask).toHaveBeenCalledWith(
      'app-A',
      'task-A',
      'user-A'
    );
  });

  it.each([false, true])(
    'does not dispatch or claim cancellation when the descriptor disables it (original owner: %s)',
    async hasOriginalOwner => {
      useChatStore.setState({
        currentTaskId: 'task-A',
        isWaitingForResponse: true,
      });
      const input = stopInput();
      input.currentAppInstance = {
        instance_id: 'app-A',
        descriptor: { effectiveActions: { cancellation: false } },
      } as never;
      if (hasOriginalOwner)
        chatSubmissionOwners.set(input.isSubmittingRef, {
          appConfig: {
            appId: 'app-A',
            instance: { instance_id: 'app-A' } as never,
          },
          isCurrent: () => true,
          onStopped: jest.fn(),
        });
      expect(await executeChatStop(input)).toEqual({
        confirmed: false,
        current: true,
        taskId: 'task-A',
      });
      expect(stopDifyStreamingTask).not.toHaveBeenCalled();
      expect(useChatStore.getState().currentTaskId).toBe('task-A');
      expect(input.isSubmittingRef.current).toBe(true);
    }
  );

  it('does not release a pre-acceptance submission or claim it was canceled', async () => {
    useChatStore.setState({ isWaitingForResponse: true });
    const input = stopInput();
    expect(await executeChatStop(input)).toEqual({
      confirmed: false,
      current: true,
    });
    expect(stopDifyStreamingTask).not.toHaveBeenCalled();
    expect(useChatStore.getState().isWaitingForResponse).toBe(true);
    expect(input.isSubmittingRef.current).toBe(true);
  });

  it('coalesces repeat clicks before first-row stop confirmation', async () => {
    let confirm!: (
      value: Awaited<ReturnType<typeof stopDifyStreamingTask>>
    ) => void;
    jest.mocked(stopDifyStreamingTask).mockImplementation(
      () =>
        new Promise(resolve => {
          confirm = resolve;
        })
    );
    useChatStore.setState({
      currentTaskId: 'task-A',
      isWaitingForResponse: true,
    });
    const input = stopInput();
    const first = executeChatStop(input);
    const duplicate = await executeChatStop(input);
    confirm({ result: 'success' });
    await first;
    expect(duplicate).toEqual({
      confirmed: false,
      current: true,
      taskId: 'task-A',
    });
    expect(stopDifyStreamingTask).toHaveBeenCalledTimes(1);
    expect(input.isSubmittingRef.current).toBe(false);
  });

  it.each(['failure', 'unknown'])(
    'retains ownership on an unconfirmed stop: %s',
    async kind => {
      jest.mocked(stopDifyStreamingTask).mockImplementation(async () => {
        if (kind === 'failure') throw new Error('offline');
        return { result: 'unknown' } as never;
      });
      useChatStore.setState({
        currentTaskId: 'task-A',
        isWaitingForResponse: true,
        streamingMessageId: 'assistant-A',
        messages: [
          {
            id: 'assistant-A',
            text: 'partial',
            isUser: false,
            isStreaming: true,
          },
        ],
      });
      const input = stopInput();
      await executeChatStop(input);
      expect(useChatStore.getState().currentTaskId).toBe('task-A');
      expect(useChatStore.getState().isWaitingForResponse).toBe(true);
      expect(useChatStore.getState().messages[0].wasManuallyStopped).not.toBe(
        true
      );
      expect(input.isSubmittingRef.current).toBe(true);
      expect(input.saveStoppedAssistantMessage).not.toHaveBeenCalled();
    }
  );

  it('saves captured A after a delayed stop without clearing B task or lock', async () => {
    let confirm!: (
      value: Awaited<ReturnType<typeof stopDifyStreamingTask>>
    ) => void;
    jest.mocked(stopDifyStreamingTask).mockImplementation(
      () =>
        new Promise(resolve => {
          confirm = resolve;
        })
    );
    useChatStore.setState({
      currentTaskId: 'task-A',
      streamingMessageId: 'assistant-A',
      messages: [
        {
          id: 'assistant-A',
          text: 'partial A',
          isUser: false,
          isStreaming: true,
        },
      ],
    });
    const input = stopInput();
    const pending = executeChatStop(input);
    await Promise.resolve();
    useChatStore.setState({
      currentTaskId: 'task-B',
      streamingMessageId: 'assistant-B',
      isWaitingForResponse: true,
      messages: [
        { id: 'assistant-B', text: 'B', isUser: false, isStreaming: true },
      ],
    });
    confirm({ result: 'success' });
    expect(await pending).toEqual({
      confirmed: true,
      current: false,
      taskId: 'task-A',
    });
    expect(useChatStore.getState().currentTaskId).toBe('task-B');
    expect(useChatStore.getState().isWaitingForResponse).toBe(true);
    expect(input.isSubmittingRef.current).toBe(true);
    expect(input.saveStoppedAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'assistant-A', text: 'partial A' }),
      'db-A'
    );
  });

  it('persists the stopped assistant even when no unsaved user message exists', async () => {
    useChatStore.setState(state => ({
      ...state,
      messages: [
        {
          id: 'assistant-1',
          text: '<think>partial',
          isUser: false,
          isStreaming: false,
          persistenceStatus: 'pending',
        },
      ],
    }));

    const saveStoppedAssistantMessage = jest.fn().mockResolvedValue(true);

    await persistStoppedStreamingState({
      currentStreamingId: 'assistant-1',
      dbConversationUUID: 'conv-1',
      difyConversationId: 'dify-conv-1',
      setDbConversationUUID: jest.fn(),
      updateMessage: useChatStore.getState().updateMessage,
      saveMessage: jest.fn().mockResolvedValue(true),
      saveStoppedAssistantMessage,
    });

    expect(saveStoppedAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-1',
        wasManuallyStopped: true,
        metadata: expect.objectContaining({
          stopped_manually: true,
          stopped_at: expect.any(String),
          stopped_response_text: '<think>partial',
        }),
      }),
      'conv-1'
    );

    expect(useChatStore.getState().messages[0]).toEqual(
      expect.objectContaining({
        wasManuallyStopped: true,
        metadata: expect.objectContaining({
          stopped_manually: true,
          stopped_response_text: '<think>partial',
        }),
      })
    );
  });

  it('saves the unsaved user message before the stopped assistant in a new conversation', async () => {
    useChatStore.setState(state => ({
      ...state,
      messages: [
        {
          id: 'user-1',
          text: 'hello',
          isUser: true,
          persistenceStatus: 'pending',
        },
        {
          id: 'assistant-1',
          text: '<think>partial',
          isUser: false,
          isStreaming: false,
          persistenceStatus: 'pending',
        },
      ],
    }));

    const saveMessage = jest.fn().mockResolvedValue(true);
    const saveStoppedAssistantMessage = jest.fn().mockResolvedValue(true);

    await persistStoppedStreamingState({
      currentStreamingId: 'assistant-1',
      dbConversationUUID: 'conv-1',
      difyConversationId: null,
      setDbConversationUUID: jest.fn(),
      updateMessage: useChatStore.getState().updateMessage,
      saveMessage,
      saveStoppedAssistantMessage,
    });

    expect(saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'conv-1'
    );
    expect(saveStoppedAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'assistant-1' }),
      'conv-1'
    );
    expect(saveMessage.mock.invocationCallOrder[0]).toBeLessThan(
      saveStoppedAssistantMessage.mock.invocationCallOrder[0]
    );
  });
});
