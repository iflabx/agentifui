import { useChatStore } from '@lib/stores/chat-store';

import { finalizeChatSubmitStream } from './submit-recovery';

describe('finalizeChatSubmitStream', () => {
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

  it('persists a manually stopped assistant message even after streaming is cleared', async () => {
    useChatStore.setState(state => ({
      ...state,
      messages: [
        {
          id: 'assistant-1',
          text: '<think>draft only',
          isUser: false,
          isStreaming: false,
          wasManuallyStopped: true,
          persistenceStatus: 'pending',
        },
      ],
    }));

    const finalizeStreamingMessage = jest.fn();
    const updateMessage = jest.fn(
      (id: string, updates: Record<string, unknown>) => {
        useChatStore.getState().updateMessage(id, updates);
      }
    );
    const saveMessage = jest.fn().mockResolvedValue(true);
    const saveStoppedAssistantMessage = jest.fn().mockResolvedValue(true);

    await finalizeChatSubmitStream({
      assistantMessageId: 'assistant-1',
      finalDbConvUUID: 'conv-1',
      dbConversationUUID: null,
      finalizeStreamingMessage,
      updateMessage,
      saveMessage,
      saveStoppedAssistantMessage,
      isNewConversationFlow: false,
    });

    expect(finalizeStreamingMessage).not.toHaveBeenCalled();
    expect(updateMessage).toHaveBeenCalledWith('assistant-1', {
      persistenceStatus: 'pending',
    });
    expect(saveStoppedAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-1',
        wasManuallyStopped: true,
        text: '<think>draft only',
      }),
      'conv-1'
    );
    expect(saveMessage).not.toHaveBeenCalled();
  });

  it('patches a manually stopped assistant message even if it was already saved', async () => {
    useChatStore.setState(state => ({
      ...state,
      messages: [
        {
          id: 'assistant-2',
          text: '<think>draft only',
          isUser: false,
          isStreaming: false,
          wasManuallyStopped: true,
          persistenceStatus: 'saved',
          db_id: 'db-assistant-2',
        },
      ],
    }));

    const finalizeStreamingMessage = jest.fn();
    const updateMessage = jest.fn();
    const saveMessage = jest.fn().mockResolvedValue(true);
    const saveStoppedAssistantMessage = jest.fn().mockResolvedValue(true);

    await finalizeChatSubmitStream({
      assistantMessageId: 'assistant-2',
      finalDbConvUUID: 'conv-1',
      dbConversationUUID: null,
      finalizeStreamingMessage,
      updateMessage,
      saveMessage,
      saveStoppedAssistantMessage,
      isNewConversationFlow: false,
    });

    expect(finalizeStreamingMessage).not.toHaveBeenCalled();
    expect(updateMessage).not.toHaveBeenCalled();
    expect(saveStoppedAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-2',
        wasManuallyStopped: true,
        db_id: 'db-assistant-2',
      }),
      'conv-1'
    );
    expect(saveMessage).not.toHaveBeenCalled();
  });

  it('does not persist a non-streaming non-stopped assistant message', async () => {
    useChatStore.setState(state => ({
      ...state,
      messages: [
        {
          id: 'assistant-1',
          text: 'plain reply',
          isUser: false,
          isStreaming: false,
          persistenceStatus: 'pending',
        },
      ],
    }));

    const finalizeStreamingMessage = jest.fn();
    const updateMessage = jest.fn();
    const saveMessage = jest.fn().mockResolvedValue(true);
    const saveStoppedAssistantMessage = jest.fn().mockResolvedValue(true);

    await finalizeChatSubmitStream({
      assistantMessageId: 'assistant-1',
      finalDbConvUUID: 'conv-1',
      dbConversationUUID: null,
      finalizeStreamingMessage,
      updateMessage,
      saveMessage,
      saveStoppedAssistantMessage,
      isNewConversationFlow: false,
    });

    expect(finalizeStreamingMessage).not.toHaveBeenCalled();
    expect(updateMessage).not.toHaveBeenCalled();
    expect(saveMessage).not.toHaveBeenCalled();
    expect(saveStoppedAssistantMessage).not.toHaveBeenCalled();
  });
});
