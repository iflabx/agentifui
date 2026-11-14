import { captureDifyInputSubmission } from '@components/chat-input/submission';
import { saveConversationRecord } from '@lib/hooks/create-conversation/persistence';
import type { CreateConversationResult } from '@lib/hooks/create-conversation/types';
import { bindChatInputConversation } from '@lib/hooks/use-chat-input-route-sync';
import { useCreateConversation } from '@lib/hooks/use-create-conversation';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import {
  chatInputScope,
  useChatInputStore,
} from '@lib/stores/chat-input-store';
import { useChatStore } from '@lib/stores/chat-store';
import { act, renderHook } from '@testing-library/react';
import {
  ReadableStream,
  type ReadableStreamDefaultController,
} from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';

import type { ChatResolvedAppConfig } from './app-config';
import { executeChatSubmit } from './submit-flow';
import { startExistingChatConversation } from './submit-start';
import type { ChatSubmissionAccepted } from './types';

jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({ session: { user: { id: 'actor' } } }),
}));
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('@lib/stores/favorite-apps-store', () => ({
  useAutoAddFavoriteApp: () => ({ addToFavorites: jest.fn() }),
}));
jest.mock('@lib/hooks/create-conversation/persistence', () => ({
  saveConversationRecord: jest.fn(),
  startConversationTitleResolution: jest.fn(),
  recoverConversationTitleAfterStream: jest.fn().mockResolvedValue(true),
}));
jest.mock('@lib/hooks/use-chat-input-route-sync', () => ({
  bindChatInputConversation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@lib/services/client/conversations-api', () => ({
  getConversationByExternalId: jest.fn().mockResolvedValue({ success: false }),
}));
jest.mock('@lib/services/client/messages-api', () => ({
  updateMessageMetadataRecord: jest.fn(),
}));

global.TextDecoder = TextDecoder as typeof global.TextDecoder;

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(finish => {
    resolve = finish;
  });
  return { promise, resolve };
}

function sseSource() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    body,
  });
  return {
    send: (event: unknown) =>
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
      ),
    close: () => controller.close(),
  };
}

function activate(target: string) {
  const scope = chatInputScope(
    useChatInputStore.getState().actorEpoch,
    'actor',
    'app',
    target
  );
  useChatInputStore.getState().setCurrentRoute(scope);
  useAttachmentStore.getState().setScope(scope);
  return scope;
}

describe('real lazy Dify SSE submission binding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    window.history.replaceState({}, '', '/chat/new');
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      currentTaskId: null,
      streamingMessageId: null,
      isWaitingForResponse: false,
    });
    useChatInputStore.getState().setActor(null);
    useChatInputStore.getState().setActor('actor');
    useAttachmentStore.getState().resetAll();
    activate('new:A');
    useChatInputStore.getState().setMessage('Question');
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([false, true])(
    'saves a new lazy reply to its own DB ID (leave before delayed save: %s)',
    async leave => {
      const source = sseSource();
      const database = deferred<string | null>();
      jest.mocked(saveConversationRecord).mockImplementation(async input => {
        const dbId = await database.promise;
        if (dbId) input.onDbIdCreated?.(input.difyConvId, dbId);
        return dbId;
      });
      const { result } = renderHook(() => useCreateConversation());
      const created = deferred<CreateConversationResult>();
      const accepted = deferred<ChatSubmissionAccepted>();
      const acceptInput = captureDifyInputSubmission('Question', 'actor');
      let active = true;
      const initial = useChatStore.getState();
      const saveMessage = jest.fn().mockResolvedValue(true);
      const setDbConversationUUID = jest.fn();
      const navigateToConversation = jest.fn();
      const chunkBufferRef = { current: '' };
      const appendTimerRef = { current: null as NodeJS.Timeout | null };
      let work!: Promise<void>;
      await act(async () => {
        work = executeChatSubmit({
          message: 'Question',
          currentUserId: 'actor',
          appConfig: { appId: 'app' } as ChatResolvedAppConfig,
          currentPathname: '/chat/new',
          difyConversationId: null,
          dbConversationUUID: null,
          isWelcomeScreen: true,
          viewScope: { isCurrent: () => active, onRouteAdopted: jest.fn() },
          onAccepted: binding => {
            acceptInput('app', binding);
            accepted.resolve(binding);
          },
          isSubmittingRef: { current: false },
          chunkBufferRef,
          appendTimerRef,
          setIsWelcomeScreen: jest.fn(),
          setDifyConversationId: jest.fn(),
          setDbConversationUUID,
          setCurrentConversationId: initial.setCurrentConversationId,
          setCurrentTaskId: initial.setCurrentTaskId,
          setIsWaitingForResponse: initial.setIsWaitingForResponse,
          addMessage: initial.addMessage,
          updateMessage: initial.updateMessage,
          setMessageError: initial.setMessageError,
          finalizeStreamingMessage: initial.finalizeStreamingMessage,
          markAsManuallyStopped: initial.markAsManuallyStopped,
          updatePendingStatus: jest.fn(),
          saveMessage,
          saveStoppedAssistantMessage: jest.fn().mockResolvedValue(true),
          saveErrorPlaceholder: jest.fn().mockResolvedValue(true),
          initiateNewConversation: async (...args) => {
            const value = await result.current.initiateNewConversation(...args);
            created.resolve(value);
            return value;
          },
          navigateToConversation,
          flushChunkBuffer: id => {
            if (id && chunkBufferRef.current)
              initial.appendMessageChunk(id, chunkBufferRef.current);
            chunkBufferRef.current = '';
          },
          chunkAppendInterval: 0,
          moderationT: key => key,
          incompleteAnswerMessage: 'Incomplete',
        });
        await created.promise;
      });
      const creation = await created.promise;
      expect(creation.realConvId).toBeUndefined();
      expect(creation.taskId).toBeUndefined();
      expect(saveConversationRecord).not.toHaveBeenCalled();
      expect(useChatInputStore.getState().message).toBe('Question');
      source.send({
        event: 'workflow_started',
        conversation_id: 'external-A',
        task_id: 'task-A',
        data: {},
      });
      await accepted.promise;
      expect(useChatInputStore.getState().message).toBe('');
      expect(useChatStore.getState().currentTaskId).toBe('task-A');
      expect(saveConversationRecord).toHaveBeenCalledTimes(1);
      expect(saveMessage).not.toHaveBeenCalled();
      source.send({
        event: 'message',
        conversation_id: 'external-A',
        task_id: 'task-A',
        answer: 'Original answer',
      });
      source.send({
        event: 'message_end',
        conversation_id: 'external-A',
        task_id: 'task-A',
        message_id: 'message-A',
        metadata: { source: 'A' },
      });
      source.close();
      await creation.completionPromise;
      const nextMessages = [
        { id: 'B-message', text: 'B reply', isUser: false },
      ];
      if (leave) {
        active = false;
        window.history.replaceState({}, '', '/chat/B');
        activate('conversation:B');
        useChatInputStore.getState().setMessage('B draft');
        useChatStore.setState({
          messages: nextMessages,
          currentConversationId: 'B',
          currentTaskId: 'B-task',
          streamingMessageId: null,
          isWaitingForResponse: true,
        });
        setDbConversationUUID.mockClear();
        navigateToConversation.mockClear();
      }
      database.resolve('db-A');
      await act(async () => {
        await work;
      });
      await expect(creation.conversationPersistencePromise).resolves.toBe(
        'db-A'
      );
      expect(saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Original answer', isUser: false }),
        'db-A'
      );
      expect(saveMessage.mock.calls.every(call => call[1] === 'db-A')).toBe(
        true
      );
      expect(bindChatInputConversation).toHaveBeenCalledWith(
        expect.any(String),
        'actor',
        'app',
        'external-A',
        creation.conversationPersistencePromise
      );
      if (leave) {
        expect(useChatStore.getState().messages).toEqual(nextMessages);
        expect(useChatStore.getState().currentConversationId).toBe('B');
        expect(useChatStore.getState().currentTaskId).toBe('B-task');
        expect(useChatStore.getState().isWaitingForResponse).toBe(true);
        expect(useChatInputStore.getState().message).toBe('B draft');
        expect(setDbConversationUUID).not.toHaveBeenCalled();
        expect(navigateToConversation).not.toHaveBeenCalled();
      }
    }
  );

  it('accepts an existing conversation task before any answer and clears only its captured draft after navigation', async () => {
    const source = sseSource();
    const original = useChatInputStore.getState().currentRoute;
    useAttachmentStore.getState().addFiles([new File(['a'], 'a.txt')]);
    const acceptInput = captureDifyInputSubmission('Question', 'actor');
    const accepted = deferred<ChatSubmissionAccepted>();
    const saveMessage = jest.fn().mockResolvedValue(true);
    const started = await startExistingChatConversation({
      message: 'Question',
      appId: 'app',
      currentUserId: 'actor',
      difyConversationId: 'external-A',
      dbConversationUUID: 'db-A',
      userMessage: { id: 'user-A', text: 'Question', isUser: true },
      currentPathname: '/chat/external-A',
      saveMessage,
      setDifyConversationId: jest.fn(),
      setCurrentConversationId: jest.fn(),
      setDbConversationUUID: jest.fn(),
      setCurrentTaskId: jest.fn(),
      navigateToConversation: jest.fn(),
      onAccepted: binding => {
        acceptInput('app', binding);
        accepted.resolve(binding);
      },
    });
    expect(started.finalTaskId).toBeUndefined();
    const consumption = (async () => {
      for await (const chunk of started.answerStream!) void chunk;
    })();
    activate('conversation:B');
    useChatInputStore.getState().setMessage('B draft');
    useAttachmentStore.getState().addFiles([new File(['b'], 'b.txt')]);
    source.send({
      event: 'workflow_started',
      conversation_id: 'external-A',
      task_id: 'task-A',
      data: {},
    });
    await expect(accepted.promise).resolves.toMatchObject({
      externalId: 'external-A',
      taskId: 'task-A',
    });
    expect(
      useChatInputStore.getState().messagesByRoute[original]
    ).toBeUndefined();
    expect(useAttachmentStore.getState().getFiles(original)).toEqual([]);
    expect(useChatInputStore.getState().message).toBe('B draft');
    expect(useAttachmentStore.getState().files[0].name).toBe('b.txt');
    source.send({
      event: 'message_end',
      conversation_id: 'external-A',
      task_id: 'task-A',
      metadata: {},
    });
    source.close();
    await consumption;
    expect(started.getBinding?.()).toMatchObject({
      externalId: 'external-A',
      taskId: 'task-A',
      dbConversationId: 'db-A',
    });
    expect(saveMessage.mock.calls.every(call => call[1] === 'db-A')).toBe(true);
  });

  it.each(['eof', 'error', 'cancel', 'fetch'] as const)(
    'settles an uncreated binding on %s without accepting or clearing the draft',
    async ending => {
      const source = sseSource();
      if (ending === 'fetch')
        (global.fetch as jest.Mock).mockRejectedValueOnce(
          new Error('Network failure')
        );
      const { result } = renderHook(() => useCreateConversation());
      const accepted = jest.fn();
      let creation!: CreateConversationResult;
      await act(async () => {
        creation = await result.current.initiateNewConversation(
          { query: 'Question', user: 'actor' },
          'app',
          'actor',
          undefined,
          undefined,
          undefined,
          accepted
        );
      });
      if (ending === 'cancel') await creation.answerStream!.return();
      else if (ending !== 'fetch') {
        if (ending === 'error')
          source.send({
            event: 'error',
            conversation_id: 'rejected-id',
            task_id: 'rejected-task',
            code: 'bad_request',
            message: 'Rejected',
          });
        source.close();
        const consumption = (async () => {
          for await (const chunk of creation.answerStream!) void chunk;
        })();
        if (ending === 'error')
          await expect(consumption).rejects.toThrow('Rejected');
        else await consumption;
      }
      await expect(creation.conversationPersistencePromise).resolves.toBeNull();
      expect(saveConversationRecord).not.toHaveBeenCalled();
      expect(accepted).not.toHaveBeenCalled();
      expect(useChatInputStore.getState().message).toBe('Question');
    }
  );
});
