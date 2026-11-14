import { useChatStore } from '@lib/stores/chat-store';

import type { ChatResolvedAppConfig } from './app-config';
import { executeChatSubmit } from './submit-flow';
import {
  startExistingChatConversation,
  startNewChatConversation,
} from './submit-start';

jest.mock('./submit-start', () => ({
  ...jest.requireActual('./submit-start'),
  startExistingChatConversation: jest.fn(),
  startNewChatConversation: jest.fn(),
}));

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('Dify interrupted submission persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    useChatStore.setState({
      messages: [],
      streamingMessageId: null,
      currentConversationId: 'original',
      currentTaskId: null,
      isWaitingForResponse: false,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    { target: 'existing', detachBeforeFirstChunk: false },
    { target: 'existing', detachBeforeFirstChunk: true },
    { target: 'lazy', detachBeforeFirstChunk: false },
    { target: 'lazy', detachBeforeFirstChunk: true },
    { target: 'missing', detachBeforeFirstChunk: false },
    { target: 'missing', detachBeforeFirstChunk: true },
  ])(
    'preserves partial text only in the original $target target, detached before first chunk: $detachBeforeFirstChunk',
    async ({ target, detachBeforeFirstChunk }) => {
      let active = true;
      const allowFirstChunk = deferred<void>();
      const firstChunkConsumed = deferred<void>();
      const resume = deferred<void>();
      const persistence = deferred<string | null>();
      const existing = target === 'existing';
      const answerStream = (async function* () {
        await allowFirstChunk.promise;
        yield 'First ';
        firstChunkConsumed.resolve();
        await resume.promise;
        yield 'second';
        throw new Error('synthetic stream failure');
      })();
      const startResult = {
        finalDbConvUUID: existing ? 'original-db' : null,
        finalRealConvId: existing ? 'original' : undefined,
        getBinding: () => ({
          externalId: 'original',
          taskId: 'original-task',
        }),
        answerStream,
        ...(!existing
          ? { conversationPersistencePromise: persistence.promise }
          : {}),
      };
      jest.mocked(startExistingChatConversation).mockResolvedValue(startResult);
      jest.mocked(startNewChatConversation).mockResolvedValue(startResult);
      const original = useChatStore.getState();
      const saveMessage = jest.fn().mockResolvedValue(true);
      const saveErrorPlaceholder = jest.fn().mockResolvedValue(true);
      const updateMessage = jest.fn(original.updateMessage);
      const setMessageError = jest.fn(original.setMessageError);
      const setDbConversationUUID = jest.fn();
      const navigateToConversation = jest.fn();
      const chunkBufferRef = { current: '' };
      const submitting = { current: false };
      const work = executeChatSubmit({
        message: 'Original question',
        currentUserId: 'actor',
        appConfig: { appId: 'original-app' } as ChatResolvedAppConfig,
        currentPathname: existing
          ? '/chat/original'
          : '/apps/chatbot/original-app',
        difyConversationId: existing ? 'original' : null,
        dbConversationUUID: existing ? 'original-db' : null,
        isWelcomeScreen: false,
        viewScope: { isCurrent: () => active, onRouteAdopted: jest.fn() },
        isSubmittingRef: submitting,
        chunkBufferRef,
        appendTimerRef: { current: null },
        addMessage: original.addMessage,
        updateMessage,
        setIsWelcomeScreen: jest.fn(),
        setDifyConversationId: jest.fn(),
        setDbConversationUUID,
        setCurrentConversationId: original.setCurrentConversationId,
        setCurrentTaskId: original.setCurrentTaskId,
        setIsWaitingForResponse: original.setIsWaitingForResponse,
        setMessageError,
        finalizeStreamingMessage: original.finalizeStreamingMessage,
        markAsManuallyStopped: original.markAsManuallyStopped,
        updatePendingStatus: jest.fn(),
        saveMessage,
        saveStoppedAssistantMessage: jest.fn(),
        saveErrorPlaceholder,
        initiateNewConversation: jest.fn(),
        navigateToConversation,
        flushChunkBuffer: id => {
          if (id && chunkBufferRef.current) {
            original.appendMessageChunk(id, chunkBufferRef.current);
            chunkBufferRef.current = '';
          }
        },
        chunkAppendInterval: 0,
        moderationT: key => key,
        incompleteAnswerMessage: 'Incomplete',
      });
      const nextMessages = [{ id: 'B-message', text: 'Keep B', isUser: true }];
      const detach = () => {
        active = false;
        useChatStore.setState({
          messages: nextMessages,
          currentConversationId: 'B-conversation',
          currentTaskId: 'B-task',
          streamingMessageId: 'B-message',
          isWaitingForResponse: true,
        });
        updateMessage.mockClear();
        setMessageError.mockClear();
      };
      if (detachBeforeFirstChunk) detach();
      allowFirstChunk.resolve();
      await firstChunkConsumed.promise;
      if (!detachBeforeFirstChunk) detach();
      resume.resolve();
      persistence.resolve(target === 'missing' ? null : 'original-db');
      await work;

      if (target === 'missing') {
        expect(saveMessage).not.toHaveBeenCalled();
      } else {
        expect(saveMessage).toHaveBeenCalledTimes(1);
        expect(saveMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            id: expect.any(String),
            text: 'First second',
            isUser: false,
            isStreaming: false,
            error: expect.any(String),
          }),
          'original-db'
        );
      }
      expect(saveErrorPlaceholder).not.toHaveBeenCalled();
      expect(useChatStore.getState().messages).toEqual(nextMessages);
      expect(useChatStore.getState().currentConversationId).toBe(
        'B-conversation'
      );
      expect(useChatStore.getState().currentTaskId).toBe('B-task');
      expect(useChatStore.getState().streamingMessageId).toBe('B-message');
      expect(useChatStore.getState().isWaitingForResponse).toBe(true);
      expect(updateMessage).not.toHaveBeenCalled();
      expect(setMessageError).not.toHaveBeenCalled();
      expect(setDbConversationUUID).not.toHaveBeenCalled();
      expect(navigateToConversation).not.toHaveBeenCalled();
      expect(submitting.current).toBe(true);
      expect(
        existing ? startExistingChatConversation : startNewChatConversation
      ).toHaveBeenCalledTimes(1);
      expect(
        existing ? startNewChatConversation : startExistingChatConversation
      ).not.toHaveBeenCalled();
    }
  );
});
