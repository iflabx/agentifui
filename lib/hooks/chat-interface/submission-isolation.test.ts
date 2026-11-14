import { useChatStore } from '@lib/stores/chat-store';

import type { ChatResolvedAppConfig } from './app-config';
import { executeChatSubmit } from './submit-flow';
import { startExistingChatConversation } from './submit-start';

jest.mock('./submit-start', () => ({
  ...jest.requireActual('./submit-start'),
  startExistingChatConversation: jest.fn(),
}));
jest.mock('@lib/services/client/messages-api', () => ({
  updateMessageMetadataRecord: jest.fn(),
}));

describe('Dify submission view isolation', () => {
  it('continues consuming and saving the original reply after navigation without writing the next view', async () => {
    let active = true;
    let continueStream: () => void = () => undefined;
    const paused = new Promise<void>(resolve => {
      continueStream = resolve;
    });
    let firstChunk: () => void = () => undefined;
    const started = new Promise<void>(resolve => {
      firstChunk = resolve;
    });
    useChatStore.setState({
      messages: [],
      streamingMessageId: null,
      currentConversationId: 'original',
      currentTaskId: null,
      isWaitingForResponse: false,
    });
    jest.mocked(startExistingChatConversation).mockResolvedValue({
      finalDbConvUUID: 'original-db',
      finalRealConvId: 'original',
      answerStream: (async function* () {
        yield 'First ';
        firstChunk();
        await paused;
        yield 'second';
      })(),
      completionPromise: Promise.resolve({
        messageId: 'native-message',
        metadata: { source: 'original' },
        usage: { total_tokens: 2 },
      }),
    });
    const initial = useChatStore.getState();
    const setDbConversationUUID = jest.fn();
    const navigateToConversation = jest.fn();
    const saveMessage = jest.fn().mockResolvedValue(true);
    const chunkBufferRef = { current: '' };
    const appendTimerRef = { current: null as NodeJS.Timeout | null };
    const submitting = { current: false };
    const work = executeChatSubmit({
      message: 'Question',
      currentUserId: 'actor',
      appConfig: { appId: 'app' } as ChatResolvedAppConfig,
      currentPathname: '/chat/original',
      difyConversationId: 'original',
      dbConversationUUID: 'original-db',
      isWelcomeScreen: false,
      viewScope: { isCurrent: () => active, onRouteAdopted: jest.fn() },
      isSubmittingRef: submitting,
      chunkBufferRef,
      appendTimerRef,
      addMessage: initial.addMessage,
      updateMessage: initial.updateMessage,
      setIsWelcomeScreen: jest.fn(),
      setDifyConversationId: jest.fn(),
      setDbConversationUUID,
      setCurrentConversationId: initial.setCurrentConversationId,
      setCurrentTaskId: initial.setCurrentTaskId,
      setIsWaitingForResponse: initial.setIsWaitingForResponse,
      setMessageError: initial.setMessageError,
      finalizeStreamingMessage: initial.finalizeStreamingMessage,
      markAsManuallyStopped: initial.markAsManuallyStopped,
      updatePendingStatus: jest.fn(),
      saveMessage,
      saveStoppedAssistantMessage: jest.fn(),
      saveErrorPlaceholder: jest.fn(),
      initiateNewConversation: jest.fn(),
      navigateToConversation,
      flushChunkBuffer: id => {
        if (id && chunkBufferRef.current) {
          initial.appendMessageChunk(id, chunkBufferRef.current);
          chunkBufferRef.current = '';
        }
      },
      chunkAppendInterval: 0,
      moderationT: key => key,
      incompleteAnswerMessage: 'Incomplete',
    });
    await started;
    active = false;
    const nextMessages = [
      { id: 'next', text: 'Next conversation', isUser: true },
    ];
    useChatStore.setState({
      messages: nextMessages,
      currentConversationId: 'next',
      streamingMessageId: null,
      isWaitingForResponse: true,
    });
    setDbConversationUUID.mockClear();
    continueStream();
    await work;
    expect(saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'First second',
        isUser: false,
        metadata: expect.objectContaining({
          dify_metadata: { source: 'original' },
        }),
      }),
      'original-db'
    );
    expect(
      saveMessage.mock.calls.every(call => call[1] === 'original-db')
    ).toBe(true);
    expect(useChatStore.getState().messages).toEqual(nextMessages);
    expect(useChatStore.getState().isWaitingForResponse).toBe(true);
    expect(useChatStore.getState().currentConversationId).toBe('next');
    expect(setDbConversationUUID).not.toHaveBeenCalled();
    expect(navigateToConversation).not.toHaveBeenCalled();
    expect(submitting.current).toBe(true);
  });
});
