'use client';

import {
  ChatLoader,
  MessagesLoadingIndicator,
  PageLoadingSpinner,
  WelcomeScreen,
} from '@components/chat';
import { ChatInput } from '@components/chat-input';
import { DifyEditProvider } from '@components/chat-input/edit-resend';
import { DynamicSuggestedQuestions } from '@components/chat/dynamic-suggested-questions';
import { ChatSessionView } from '@components/chat/session/chat-session-view';
import { ChatflowFloatingController } from '@components/chatflow/chatflow-floating-controller';
import { ChatflowInputArea } from '@components/chatflow/chatflow-input-area';
import { ChatflowNodeTracker } from '@components/chatflow/chatflow-node-tracker';
import { AgentChat } from '@components/langchain/agent-chat';
import { TaskChat } from '@components/task-chat/task-chat';
import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { resolveHistoryAttachmentPreviewUserId } from '@lib/hooks/history-attachment-preview';
import { useChatInterface } from '@lib/hooks/use-chat-interface';
import { useChatPageState } from '@lib/hooks/use-chat-page-state';
import { useChatScroll } from '@lib/hooks/use-chat-scroll';
import { useChatflowDetection } from '@lib/hooks/use-chatflow-detection';
import { useChatflowExecutionView } from '@lib/hooks/use-chatflow-execution-view';
import { useChatflowInterface } from '@lib/hooks/use-chatflow-interface';
import { useChatflowState } from '@lib/hooks/use-chatflow-state';
import { useConversationMessages } from '@lib/hooks/use-conversation-messages';
import { useHistoryAttachmentPreviewSync } from '@lib/hooks/use-history-attachment-preview-sync';
import { useProfile } from '@lib/hooks/use-profile';
import { getConversationByExternalId } from '@lib/services/client/conversations-api';
import { useChatLayoutStore } from '@lib/stores/chat-layout-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import { readChatflowExecutionMetadata } from '@lib/stores/chatflow-execution-store/history';
import { useFilePreviewStore } from '@lib/stores/ui/file-preview-store';

import React from 'react';
import { useEffect, useLayoutEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import { useParams, usePathname } from 'next/navigation';

export default function ChatPage() {
  const params = useParams<{ conversationId: string }>();
  const id = params?.conversationId ?? '';
  const { session, loading } = useAuthSession();
  const actorId = session?.user.id;
  const pathname = usePathname() ?? '';
  const executionView = useChatflowExecutionView(actorId, pathname, loading);
  const hasExecutionView = Boolean(executionView);
  const t = useTranslations('langchain');
  const [routing, setRouting] = useState<{
    key: string;
    appId?: string;
    conversationId?: string;
    taskType?: 'workflow' | 'text-generation';
    failed?: boolean;
  } | null>(null);
  const key = JSON.stringify([actorId, id]);
  const legacyNew = !id || id === 'new' || id.startsWith('temp-');
  useEffect(() => {
    if (legacyNew || hasExecutionView || loading || !actorId) return;
    let active = true;
    void getConversationByExternalId(id)
      .then(result => {
        if (!active) return;
        if (!result.success) {
          setRouting({ key, failed: true });
          return;
        }
        const conversation = result.data;
        const taskType =
          conversation?.metadata?.runtime === 'dify-task'
            ? conversation.metadata.task_type
            : null;
        setRouting({
          key,
          ...((taskType === 'workflow' || taskType === 'text-generation') &&
          conversation?.app_id
            ? {
                appId: conversation.app_id,
                conversationId: conversation.id,
                taskType,
              }
            : {}),
          ...(conversation?.interaction_protocol === 'ag-ui/1.0' &&
          conversation.app_id
            ? { appId: conversation.app_id, conversationId: conversation.id }
            : {}),
        });
      })
      .catch(() => {
        if (active) setRouting({ key, failed: true });
      });
    return () => {
      active = false;
    };
  }, [actorId, id, key, legacyNew, hasExecutionView, loading]);
  if (legacyNew || hasExecutionView || (!loading && !actorId))
    return (
      <LegacyChatPage
        executionScope={executionView?.scope}
        preserveMessages={executionView?.paths.some(path =>
          path.startsWith('/chat/temp-')
        )}
        authLoading={loading}
      />
    );
  if (routing?.key !== key) return <p role="status">{t('loading')}</p>;
  if (routing.failed) return <p role="alert">{t('requestFailed')}</p>;
  if (routing.taskType && routing.appId)
    return (
      <TaskChat
        appId={routing.appId}
        conversationId={routing.conversationId}
        taskType={routing.taskType}
      />
    );
  return routing.appId ? (
    <AgentChat
      key={routing.appId}
      appId={routing.appId}
      conversationId={routing.conversationId ?? null}
    />
  ) : (
    <LegacyChatPage authLoading={loading} />
  );
}

function LegacyChatPage({
  executionScope,
  preserveMessages = false,
  authLoading,
}: {
  executionScope?: string;
  preserveMessages?: boolean;
  authLoading: boolean;
}) {
  const params = useParams<{ conversationId: string }>();
  const conversationIdFromUrl =
    typeof params?.conversationId === 'string' ? params.conversationId : '';
  const pathname = usePathname() ?? '';
  const t = useTranslations('pages.chat.input');
  const { session } = useAuthSession();

  // Get chatflow execution state cleanup method
  const { resetExecution } = useChatflowExecutionStore();

  // Use useChatPageState hook to manage chat page state
  // This can reduce the state management logic in the page component
  const {
    isWelcomeScreen,
    isSubmitting,
    isTransitioningToWelcome,
    wrapHandleSubmit,
  } = useChatPageState(conversationIdFromUrl);

  const { inputHeight } = useChatLayoutStore();
  const isPreviewOpen = useFilePreviewStore(state => state.isPreviewOpen);
  const trackerButtonRef = React.useRef<HTMLButtonElement>(null);
  const regularInterface = useChatInterface();
  const { conversationAppId } = regularInterface;
  const storedMessages = useChatStore(state => state.messages);

  // Use the wrapped hook to detect chatflow apps
  const { isChatflowApp, currentConversationApp } = useChatflowDetection();
  const chatflowInterface = useChatflowInterface(
    isChatflowApp ? currentConversationApp?.instance_id : null
  );

  const persistedChatflowExecution = React.useMemo(() => {
    if (!isChatflowApp) return null;

    for (const message of [...storedMessages].reverse()) {
      if (message.isUser) continue;
      const snapshot = readChatflowExecutionMetadata(message.metadata);
      if (snapshot) return snapshot;
    }

    return null;
  }, [isChatflowApp, storedMessages]);

  // Use the wrapped hook to manage chatflow state
  const {
    messages,
    handleSubmit: originalHandleSubmit,
    isProcessing,
    handleStopProcessing,
    sendDirectMessage,
    showNodeTracker,
    setShowNodeTracker,
    showFloatingController,
  } = useChatflowState({
    scope:
      executionScope ??
      JSON.stringify([session?.user.id, conversationIdFromUrl]),
    isChatflowApp,
    retainCompletedExecution:
      Boolean(executionScope) || Boolean(persistedChatflowExecution),
    chatflowInterface,
    regularInterface,
  });

  useEffect(() => {
    if (!isChatflowApp || !persistedChatflowExecution || isProcessing) return;

    const executionState = useChatflowExecutionStore.getState();
    if (executionState.isExecuting || executionState.nodes.length > 0) return;

    executionState.restoreExecution(persistedChatflowExecution.nodes);
  }, [isChatflowApp, isProcessing, persistedChatflowExecution]);

  useLayoutEffect(() => {
    if (!authLoading && !executionScope) {
      resetExecution();
    }
  }, [
    pathname,
    conversationIdFromUrl,
    executionScope,
    authLoading,
    resetExecution,
  ]);

  // Use the pagination loading hook to get historical messages
  const {
    loading,
    hasMoreMessages,
    isLoadingMore,
    loadMoreMessages,
    setMessagesContainer,
    error,
    isLoadingInitial,
  } = useConversationMessages(
    preserveMessages ? conversationIdFromUrl : undefined
  );

  // Use wrapHandleSubmit to wrap the original handleSubmit function
  const handleSubmit = wrapHandleSubmit(originalHandleSubmit);

  const scrollRef = useChatScroll(messages);

  const isWaitingForResponse = useChatStore(
    state => state.isWaitingForResponse
  );

  // Merge scrollRef and setMessagesContainer
  // scrollRef is RefObject type, directly set current property
  const setScrollRef = (element: HTMLDivElement | null) => {
    if (scrollRef) {
      scrollRef.current = element;
    }
    setMessagesContainer(element);
  };

  const isNewChat = conversationIdFromUrl === 'new';
  const { profile: loadedProfile, isLoading: isProfileLoading } = useProfile();
  const profile = isNewChat ? loadedProfile : null;

  useHistoryAttachmentPreviewSync({
    appId: conversationAppId,
    conversationId: conversationIdFromUrl,
    userId: resolveHistoryAttachmentPreviewUserId({
      sessionUserId: session?.user?.id,
      profileUserId: loadedProfile?.id,
    }),
    messages,
  });

  const showWelcome =
    messages.length === 0 && (isNewChat || (!isSubmitting && isWelcomeScreen));

  return (
    <DifyEditProvider>
      <ChatSessionView
        inputHeight={inputHeight || 80}
        contentClassName="overflow-hidden pt-10"
        filePreview
        previewOpen={isPreviewOpen}
        header={
          <PageLoadingSpinner isLoading={isNewChat && isProfileLoading} />
        }
        showWelcome={showWelcome}
        welcome={<WelcomeScreen username={profile?.username} />}
        scrollProps={{ ref: setScrollRef, className: 'scroll-smooth' }}
        processAction={
          isChatflowApp && (
            <ChatflowFloatingController
              buttonRef={trackerButtonRef}
              isVisible={showFloatingController}
              isTrackerVisible={showNodeTracker}
              onToggleTracker={() => setShowNodeTracker(!showNodeTracker)}
            />
          )
        }
        composer={
          isChatflowApp && currentConversationApp ? (
            <ChatflowInputArea
              instanceId={currentConversationApp.instance_id}
              onSubmit={chatflowInterface.handleChatflowSubmit}
              isProcessing={isProcessing}
              isWaiting={isWaitingForResponse}
              onStop={handleStopProcessing}
              isWelcomeScreen={isWelcomeScreen && messages.length === 0}
            />
          ) : (
            <ChatInput
              onSubmit={handleSubmit}
              placeholder={t('placeholder')}
              isProcessing={isProcessing}
              isWaiting={isWaitingForResponse}
              onStop={handleStopProcessing}
              isWelcomeScreen={isWelcomeScreen}
              isTransitioningToWelcome={isTransitioningToWelcome}
              showModelSelector={isNewChat && messages.length === 0}
            />
          )
        }
        afterComposer={
          showWelcome && (
            <DynamicSuggestedQuestions onQuestionClick={sendDirectMessage} />
          )
        }
      >
        {!isLoadingInitial &&
          hasMoreMessages &&
          messages.length > 0 &&
          !isLoadingMore &&
          conversationIdFromUrl &&
          conversationIdFromUrl !== 'new' &&
          !conversationIdFromUrl.includes('temp-') && (
            <MessagesLoadingIndicator
              loadingState={loading.state}
              isLoadingMore={isLoadingMore}
              hasMoreMessages={hasMoreMessages}
              error={error}
              onRetry={loadMoreMessages}
            />
          )}

        <ChatLoader
          messages={messages}
          conversationAppId={conversationAppId}
          isWaitingForResponse={isWaitingForResponse}
          isLoadingInitial={isLoadingInitial}
        />

        {isChatflowApp && showNodeTracker && (
          <ChatflowNodeTracker
            isVisible={showNodeTracker && !isPreviewOpen}
            scope={
              executionScope ??
              JSON.stringify([conversationAppId, conversationIdFromUrl])
            }
            onClose={() => {
              setShowNodeTracker(false);
              trackerButtonRef.current?.focus();
            }}
            className="fixed right-4 bottom-40 z-30 max-w-sm transition-all duration-300"
          />
        )}
      </ChatSessionView>
    </DifyEditProvider>
  );
}
