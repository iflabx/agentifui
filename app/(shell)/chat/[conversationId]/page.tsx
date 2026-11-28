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
import { ChatflowInputArea } from '@components/chatflow/chatflow-input-area';
import { useChatflowMessageProcess } from '@components/chatflow/use-chatflow-message-process';
import { HistoryMessageView } from '@components/history/history-message';
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
import { useConversationMessages } from '@lib/hooks/use-conversation-messages';
import { useHistoryAttachmentPreviewSync } from '@lib/hooks/use-history-attachment-preview-sync';
import { useProfile } from '@lib/hooks/use-profile';
import { getConversationByExternalId } from '@lib/services/client/conversations-api';
import { useChatLayoutStore } from '@lib/stores/chat-layout-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import { useFilePreviewStore } from '@lib/stores/ui/file-preview-store';

import { useEffect, useLayoutEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import { useParams, usePathname, useSearchParams } from 'next/navigation';

export default function ChatPage() {
  const params = useParams<{ conversationId: string }>();
  const id = params?.conversationId ?? '';
  const messageId = useSearchParams()?.get('messageId');
  if (id && messageId)
    return (
      <HistoryMessageView
        conversationId={id}
        messageId={messageId}
        focusInConversation
      />
    );
  return <LiveChatPage id={id} />;
}

function LiveChatPage({ id }: { id: string }) {
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
  const isNewChat = conversationIdFromUrl === 'new';
  const pathname = usePathname() ?? '';
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
  const regularInterface = useChatInterface();
  const { conversationAppId } = regularInterface;

  // Use the wrapped hook to detect chatflow apps
  const { isChatflowApp: detectedChatflow, currentConversationApp } =
    useChatflowDetection();
  const isChatflowApp = !isNewChat && detectedChatflow;
  const chatflowInterface = useChatflowInterface(
    isChatflowApp ? currentConversationApp?.instance_id : null
  );

  const {
    messages,
    handleSubmit: originalHandleSubmit,
    isProcessing,
    handleStopProcessing,
    sendDirectMessage,
  } = isChatflowApp ? chatflowInterface : regularInterface;
  const renderProcess = useChatflowMessageProcess(
    messages,
    isChatflowApp,
    (preserveMessages ? executionScope : undefined) ??
      JSON.stringify([
        session?.user.id,
        conversationIdFromUrl,
        conversationAppId,
      ]),
    Boolean(executionScope)
  );

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
        appLayout
        appTitle={
          isNewChat
            ? undefined
            : currentConversationApp?.display_name || undefined
        }
        inputHeight={inputHeight || 80}
        contentClassName="overflow-hidden pt-10"
        filePreview
        previewOpen={isPreviewOpen}
        header={
          <PageLoadingSpinner isLoading={isNewChat && isProfileLoading} />
        }
        showWelcome={showWelcome}
        scrollProps={{ ref: setScrollRef, className: 'scroll-smooth' }}
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
              isProcessing={isProcessing}
              isWaiting={isWaitingForResponse}
              onStop={handleStopProcessing}
              isWelcomeScreen={isWelcomeScreen}
              isTransitioningToWelcome={isTransitioningToWelcome}
              showModelSelector={isNewChat && messages.length === 0}
              beforeInput={
                isNewChat && showWelcome ? (
                  <WelcomeScreen username={profile?.username} />
                ) : undefined
              }
              afterInput={
                isNewChat && showWelcome ? (
                  <DynamicSuggestedQuestions
                    inline
                    onQuestionClick={sendDirectMessage}
                  />
                ) : undefined
              }
            />
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
          renderProcess={renderProcess}
        />
      </ChatSessionView>
    </DifyEditProvider>
  );
}
