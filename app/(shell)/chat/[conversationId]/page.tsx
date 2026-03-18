'use client';

import {
  ChatInputBackdrop,
  ChatLoader,
  MessagesLoadingIndicator,
  PageLoadingSpinner,
  ScrollToBottomButton,
  WelcomeScreen,
} from '@components/chat';
import { ChatInput } from '@components/chat-input';
import { DynamicSuggestedQuestions } from '@components/chat/dynamic-suggested-questions';
import { ChatflowFloatingController } from '@components/chatflow/chatflow-floating-controller';
import { ChatflowNodeTracker } from '@components/chatflow/chatflow-node-tracker';
import { FilePreviewCanvas } from '@components/file-preview/file-preview-canvas';
import { useChatPageState } from '@lib/hooks/use-chat-page-state';
import { useChatScroll } from '@lib/hooks/use-chat-scroll';
import { useChatflowDetection } from '@lib/hooks/use-chatflow-detection';
import { useChatflowState } from '@lib/hooks/use-chatflow-state';
import { useConversationMessages } from '@lib/hooks/use-conversation-messages';
import { useProfile } from '@lib/hooks/use-profile';
import { useChatLayoutStore } from '@lib/stores/chat-layout-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import { useFilePreviewStore } from '@lib/stores/ui/file-preview-store';
import { cn } from '@lib/utils';

import React from 'react';
import { useLayoutEffect } from 'react';

import { useTranslations } from 'next-intl';
import { useParams, usePathname } from 'next/navigation';

export default function ChatPage() {
  const params = useParams<{ conversationId: string }>();
  const conversationIdFromUrl = params.conversationId;
  const pathname = usePathname();
  const t = useTranslations('pages.chat.input');

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

  // Use the wrapped hook to detect chatflow apps
  const { isChatflowApp } = useChatflowDetection();

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
  } = useChatflowState(isChatflowApp);

  // Critical fix: Clean up chatflow execution state when switching routes
  // Ensure that when switching to historical conversations, previous node data is not displayed
  useLayoutEffect(() => {
    if (
      pathname?.startsWith('/chat/') &&
      conversationIdFromUrl &&
      conversationIdFromUrl !== 'new' &&
      !conversationIdFromUrl.includes('temp-')
    ) {
      // Clean up chatflow execution state, ensure previous node data is not displayed
      resetExecution();

      console.log('[ChatPage] chatflow execution state cleanup completed');
    }
  }, [pathname, conversationIdFromUrl, resetExecution]);

  // Use the pagination loading hook to get historical messages
  const {
    loading,
    hasMoreMessages,
    isLoadingMore,
    loadMoreMessages,
    setMessagesContainer,
    error,
    isLoadingInitial,
  } = useConversationMessages();

  // Use wrapHandleSubmit to wrap the original handleSubmit function
  const handleSubmit = wrapHandleSubmit(originalHandleSubmit);

  const scrollRef = useChatScroll(messages);

  const isWaitingForResponse = useChatStore(
    state => state.isWaitingForResponse
  );

  const chatInputHeightVar = `${inputHeight || 80}px`;

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

  return (
    <div
      className={cn(
        'relative flex h-full w-full flex-col',
        'bg-stone-100 dark:bg-stone-800',
        'text-stone-900 dark:text-gray-100'
      )}
    >
      <div
        className={cn(
          'relative flex min-h-0 flex-1 flex-col overflow-hidden',
          'pt-10',
          'transition-[width] duration-300 ease-in-out',
          isPreviewOpen ? 'w-[50%] lg:w-[60%]' : 'w-full'
        )}
        style={
          { '--chat-input-height': chatInputHeightVar } as React.CSSProperties
        }
      >
        {/* Page-level loading, use PageLoadingSpinner component to ensure full-screen coverage
             Only show loading state on /chat/new route
             Only show page-level loading when profile is still in initial loading */}
        <PageLoadingSpinner isLoading={isNewChat && isProfileLoading} />

        {/* main content */}
        <div className="min-h-0 flex-1">
          {/* Conditions for showing welcome screen:
               1. New chat page with no messages
               2. Or welcome state with no messages and not submitting */}
          {/* Use full name instead of username (nickname) for now, because username may be empty */}
          {isNewChat && messages.length === 0 ? (
            <WelcomeScreen username={profile?.username} />
          ) : messages.length === 0 && !isSubmitting && isWelcomeScreen ? (
            <WelcomeScreen username={profile?.username} />
          ) : (
            <div
              ref={setScrollRef}
              className="chat-scroll-container h-full overflow-y-auto scroll-smooth"
            >
              {/* Conditions for showing "load more" button or loading indicator:
                   1. Not in initial loading state (avoid overlap with initial skeleton)
                   2. Not new conversation or temporary conversation path
                   3. Actually have more messages to load
                   4. Already have messages displayed (non-empty message list)
                   5. Not in loading more state (avoid flickering) */}
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
                isWaitingForResponse={isWaitingForResponse}
                isLoadingInitial={isLoadingInitial}
              />

              {/* New: Chatflow node tracker - only show for chatflow apps
                   Popup controlled by user clicking floating ball, or auto-popup when sending messages */}
              {isChatflowApp && showNodeTracker && (
                <ChatflowNodeTracker
                  isVisible={showNodeTracker}
                  className={cn(
                    'fixed right-4 bottom-40 z-30 max-w-sm',
                    'transition-all duration-300'
                  )}
                />
              )}
            </div>
          )}
        </div>

        <ScrollToBottomButton />

        {/* New: Chatflow floating controller - only show for chatflow apps */}
        {isChatflowApp && (
          <ChatflowFloatingController
            isVisible={showFloatingController}
            isTrackerVisible={showNodeTracker}
            onToggleTracker={() => setShowNodeTracker(!showNodeTracker)}
          />
        )}

        <ChatInputBackdrop />

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

        {/* Conditions for showing dynamic suggested questions:
             1. New chat page with no messages
             2. Or welcome state with no messages and not submitting */}
        {isNewChat && messages.length === 0 && (
          <DynamicSuggestedQuestions onQuestionClick={sendDirectMessage} />
        )}
        {!isSubmitting &&
          isWelcomeScreen &&
          messages.length === 0 &&
          conversationIdFromUrl !== 'new' && (
            <DynamicSuggestedQuestions onQuestionClick={sendDirectMessage} />
          )}
      </div>

      <FilePreviewCanvas />
    </div>
  );
}
