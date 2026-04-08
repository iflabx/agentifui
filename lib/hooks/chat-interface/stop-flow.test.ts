import { useChatStore } from '@lib/stores/chat-store';

import { persistStoppedStreamingState } from './stop-flow';

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
