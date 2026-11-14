import { captureDifyInputSubmission } from '@components/chat-input/submission';
import type { UseCreateConversationReturn } from '@lib/hooks/create-conversation/types';
import type { ChatMessage } from '@lib/stores/chat-store';
import { selectIsProcessing, useChatStore } from '@lib/stores/chat-store';
import type { PendingConversation } from '@lib/stores/pending-conversation-store';

import { useCallback, useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

import type { ChatResolvedAppConfig } from './app-config';
import { resolveChatSubmitAppConfig } from './app-config';
import type { ChatModerationTranslator } from './error-utils';
import { executeChatSubmit } from './submit-flow';
import type { ChatNodeEvent } from './types';

type ChatMessageUpdates = Partial<Omit<ChatMessage, 'id' | 'isUser'>>;

interface SubmissionViewOwner {
  active: boolean;
  paths: Set<string | null>;
  userId: string;
  routeAppId?: string | null;
  messageIds: Set<string>;
  taskIds: Set<string>;
}

function detachSubmissionView(owner: SubmissionViewOwner) {
  owner.active = false;
  const state = useChatStore.getState();
  const ownsStreaming = Boolean(
    state.streamingMessageId && owner.messageIds.has(state.streamingMessageId)
  );
  const ownsTask = Boolean(
    state.currentTaskId && owner.taskIds.has(state.currentTaskId)
  );
  const lastUser = state.messages?.filter(message => message.isUser).at(-1);
  if (
    ownsStreaming ||
    ownsTask ||
    (lastUser && owner.messageIds.has(lastUser.id))
  ) {
    state.setIsWaitingForResponse(false);
    if (ownsTask) state.setCurrentTaskId(null);
    if (ownsStreaming) useChatStore.setState({ streamingMessageId: null });
  }
}

interface UseChatSubmitHandlerInput {
  currentUserId: string | undefined;
  conversationAppId: string | null;
  preferredRouteAppId?: string | null;
  ensureAppReady: () => Promise<ChatResolvedAppConfig>;
  validateConfig: (
    appId?: string,
    context?: 'message' | 'switch' | 'general'
  ) => Promise<void>;
  addMessage: (messageData: Omit<ChatMessage, 'id'>) => ChatMessage;
  setIsWaitingForResponse: (status: boolean) => void;
  isWelcomeScreen: boolean;
  setIsWelcomeScreen: (value: boolean) => void;
  finalizeStreamingMessage: (id: string) => void;
  markAsManuallyStopped: (id: string) => void;
  setMessageError: (id: string, error: string | null) => void;
  setDifyConversationId: (conversationId: string | null) => void;
  setDbConversationUUID: (conversationId: string | null) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  currentPathname: string | null;
  difyConversationId: string | null;
  dbConversationUUID: string | null;
  onNodeEvent?: (event: ChatNodeEvent) => void;
  isSubmittingRef: MutableRefObject<boolean>;
  chunkBufferRef: MutableRefObject<string>;
  appendTimerRef: MutableRefObject<NodeJS.Timeout | null>;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
  updatePendingStatus: (
    id: string,
    status: PendingConversation['status']
  ) => void;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
  saveStoppedAssistantMessage: (
    message: ChatMessage,
    conversationId: string
  ) => Promise<boolean>;
  saveErrorPlaceholder: (
    conversationId: string,
    status?: 'sent' | 'delivered' | 'error',
    errorMessage?: string
  ) => Promise<boolean>;
  initiateNewConversation: UseCreateConversationReturn['initiateNewConversation'];
  navigateToConversation: (conversationId: string) => void;
  flushChunkBuffer: (id: string | null) => void;
  chunkAppendInterval: number;
  moderationT: ChatModerationTranslator;
  incompleteAnswerMessage: string;
}

export function useChatSubmitHandler({
  currentUserId,
  conversationAppId,
  preferredRouteAppId,
  ensureAppReady,
  validateConfig,
  addMessage,
  setIsWaitingForResponse,
  isWelcomeScreen,
  setIsWelcomeScreen,
  finalizeStreamingMessage,
  markAsManuallyStopped,
  setMessageError,
  setDifyConversationId,
  setDbConversationUUID,
  setCurrentConversationId,
  setCurrentTaskId,
  currentPathname,
  difyConversationId,
  dbConversationUUID,
  onNodeEvent,
  isSubmittingRef,
  chunkBufferRef,
  appendTimerRef,
  updateMessage,
  updatePendingStatus,
  saveMessage,
  saveStoppedAssistantMessage,
  saveErrorPlaceholder,
  initiateNewConversation,
  navigateToConversation,
  flushChunkBuffer,
  chunkAppendInterval,
  moderationT,
  incompleteAnswerMessage,
}: UseChatSubmitHandlerInput) {
  const task = useRef<SubmissionViewOwner | null>(null);
  const latest = useRef({
    currentUserId,
    currentPathname,
    preferredRouteAppId,
  });
  useLayoutEffect(() => {
    latest.current = { currentUserId, currentPathname, preferredRouteAppId };
    if (
      task.current &&
      (task.current.userId !== currentUserId ||
        task.current.routeAppId !== preferredRouteAppId ||
        !task.current.paths.has(currentPathname))
    ) {
      detachSubmissionView(task.current);
      isSubmittingRef.current = false;
      if (appendTimerRef.current) clearTimeout(appendTimerRef.current);
      appendTimerRef.current = null;
      chunkBufferRef.current = '';
    }
    if (task.current?.active && task.current.paths.has(currentPathname))
      task.current.paths = new Set([currentPathname]);
  }, [
    currentUserId,
    currentPathname,
    preferredRouteAppId,
    isSubmittingRef,
    appendTimerRef,
    chunkBufferRef,
  ]);
  useLayoutEffect(
    () => () => {
      if (task.current) detachSubmissionView(task.current);
    },
    []
  );
  return useCallback(
    async (
      message: string,
      files?: unknown[],
      inputs?: Record<string, unknown>
    ) => {
      if (isSubmittingRef.current) {
        console.warn('[handleSubmit] Submission blocked: already submitting.');
        return;
      }
      if (selectIsProcessing(useChatStore.getState())) {
        console.warn(
          '[handleSubmit] Submission blocked: chat store isProcessing.'
        );
        return;
      }

      if (!currentUserId) {
        console.error('useChatInterface.handleSubmit: User not authenticated.');
        return;
      }

      const owner = {
        active: true,
        paths: new Set([currentPathname]),
        userId: currentUserId,
        routeAppId: preferredRouteAppId,
        messageIds: new Set<string>(),
        taskIds: new Set<string>(),
      };
      task.current = owner;
      const acceptInput = captureDifyInputSubmission(message, currentUserId);
      isSubmittingRef.current = true;
      const isCurrent = () =>
        owner.active &&
        task.current === owner &&
        latest.current.currentUserId === owner.userId &&
        latest.current.preferredRouteAppId === owner.routeAppId &&
        owner.paths.has(latest.current.currentPathname);
      const viewScope = {
        isCurrent,
        onRouteAdopted: (pathname: string) => {
          if (isCurrent()) owner.paths.add(pathname);
        },
      };

      const appConfig = await resolveChatSubmitAppConfig({
        conversationAppId,
        preferredRouteAppId,
        ensureAppReady,
        validateConfig,
        onErrorMessage: errorMessage => {
          if (!isCurrent()) return;
          addMessage({
            text: `Sorry, failed to get app config: ${errorMessage}. Please check your network or contact admin.`,
            isUser: false,
            error: errorMessage,
            persistenceStatus: 'error',
          });
        },
      });

      if (!appConfig || !isCurrent()) {
        if (isCurrent()) isSubmittingRef.current = false;
        return;
      }

      try {
        await executeChatSubmit({
          onAccepted: accepted => acceptInput(appConfig.appId, accepted),
          viewScope,
          message,
          files,
          inputs,
          currentUserId,
          appConfig,
          isWelcomeScreen,
          currentPathname,
          difyConversationId,
          dbConversationUUID,
          onNodeEvent,
          isSubmittingRef,
          chunkBufferRef,
          appendTimerRef,
          setIsWelcomeScreen,
          setDifyConversationId,
          setDbConversationUUID,
          setCurrentConversationId,
          setCurrentTaskId: id => {
            if (id) owner.taskIds.add(id);
            setCurrentTaskId(id);
          },
          setIsWaitingForResponse,
          addMessage: message => {
            const added = addMessage(message);
            owner.messageIds.add(added.id);
            return added;
          },
          updateMessage,
          setMessageError,
          finalizeStreamingMessage,
          markAsManuallyStopped,
          updatePendingStatus,
          saveMessage,
          saveStoppedAssistantMessage,
          saveErrorPlaceholder,
          initiateNewConversation,
          navigateToConversation,
          flushChunkBuffer,
          chunkAppendInterval,
          moderationT,
          incompleteAnswerMessage,
        });
      } finally {
        if (isCurrent()) isSubmittingRef.current = false;
      }
    },
    [
      currentUserId,
      conversationAppId,
      preferredRouteAppId,
      ensureAppReady,
      validateConfig,
      addMessage,
      setIsWaitingForResponse,
      isWelcomeScreen,
      setIsWelcomeScreen,
      finalizeStreamingMessage,
      markAsManuallyStopped,
      setMessageError,
      setDifyConversationId,
      setDbConversationUUID,
      setCurrentConversationId,
      setCurrentTaskId,
      currentPathname,
      difyConversationId,
      dbConversationUUID,
      onNodeEvent,
      isSubmittingRef,
      chunkBufferRef,
      appendTimerRef,
      updateMessage,
      updatePendingStatus,
      saveMessage,
      saveStoppedAssistantMessage,
      saveErrorPlaceholder,
      initiateNewConversation,
      navigateToConversation,
      flushChunkBuffer,
      chunkAppendInterval,
      moderationT,
      incompleteAnswerMessage,
    ]
  );
}
