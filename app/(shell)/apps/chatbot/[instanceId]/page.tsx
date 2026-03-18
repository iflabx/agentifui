'use client';

import {
  ChatInputBackdrop,
  ChatLoader,
  ScrollToBottomButton,
  WelcomeScreen,
} from '@components/chat';
import { ChatInput } from '@components/chat-input';
import { DynamicSuggestedQuestions } from '@components/chat/dynamic-suggested-questions';
import {
  useChatInterface,
  useChatScroll,
  useChatWidth,
  useWelcomeScreen,
} from '@lib/hooks';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import { useProfile } from '@lib/hooks/use-profile';
import type { ChatUploadFile } from '@lib/services/dify/types';
import { useAppListStore } from '@lib/stores/app-list-store';
import { useChatLayoutStore } from '@lib/stores/chat-layout-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';
import { Blocks, Loader2 } from 'lucide-react';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import { useParams, usePathname, useRouter } from 'next/navigation';

export default function AppDetailPage() {
  const { widthClass, paddingClass } = useChatWidth();
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const instanceId = params.instanceId as string;
  const t = useTranslations('pages.apps');

  // get user profile, used for welcome interface display
  const { profile } = useProfile();

  // use chat interface logic, get messages status and related methods
  const {
    messages,
    handleSubmit: originalHandleSubmit,
    isProcessing,
    isWaitingForResponse,
    handleStopProcessing,
    sendDirectMessage,
  } = useChatInterface();

  // use unified welcome interface logic, now support app detail page
  const { isWelcomeScreen, setIsWelcomeScreen } = useWelcomeScreen();

  // get chat layout status, used for input box height management
  const { inputHeight } = useChatLayoutStore();
  const chatInputHeightVar = `${inputHeight || 80}px`;

  // local state management
  const [, setIsSubmitting] = useState(false);

  // add scroll management, ensure message list can scroll correctly
  const scrollRef = useChatScroll(messages);

  // sidebar selected status management
  const { selectItem } = useSidebarStore();

  // chat status management
  const { clearMessages, setCurrentConversationId } = useChatStore();

  // app initialization status
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // ensure loader shows for at least 0.7 seconds, giving the layout enough time to stabilize
  const [hasMinimumLoadTime, setHasMinimumLoadTime] = useState(false);

  // ensure loader shows for at least 0.7 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setHasMinimumLoadTime(true);
    }, 700); // 0.7 seconds

    return () => clearTimeout(timer);
  }, []);

  // app related status
  const { apps, fetchApps } = useAppListStore();
  const {
    currentAppId,
    isValidating,
    isValidatingForMessage,
    switchToSpecificApp,
  } = useCurrentApp();

  // get current app instance data
  const currentApp = apps.find(app => app.instance_id === instanceId);

  const { clearConversationState } = useChatInterface();

  useLayoutEffect(() => {
    if (pathname === `/apps/chatbot/${instanceId}`) {
      console.log(
        '[AppDetail] route changed to app detail page, clear chat state immediately'
      );

      // immediately clear all messages
      useChatStore.getState().clearMessages();
      clearMessages();

      // set current conversation id to null
      setCurrentConversationId(null);

      // clear conversation state in use-chat-interface
      // ensure difyConversationId, dbConversationUUID, conversationAppId are correctly cleared
      clearConversationState();

      // force set welcome screen state to true
      setIsWelcomeScreen(true);

      // reset submit state
      setIsSubmitting(false);

      console.log('[AppDetail] chat state cleared');
    }
  }, [
    pathname,
    instanceId,
    clearMessages,
    setCurrentConversationId,
    setIsWelcomeScreen,
    clearConversationState,
  ]);

  // page initialization: switch to target app and sync sidebar selected status
  // simplify initialization logic, avoid validation bounce, improve user experience
  useEffect(() => {
    const initializeApp = async () => {
      if (!instanceId) return;

      try {
        setInitError(null);

        console.log('[AppDetail] start initializing app:', instanceId);

        // simplify loading state check
        // only show loading state when really needed
        const needsAppListFetch = apps.length === 0;
        const currentAppMatches = currentAppId === instanceId;

        // if app list is empty, need to fetch
        if (needsAppListFetch) {
          setIsInitializing(true);
          console.log('[AppDetail] app list is empty, start fetching');
          await fetchApps();
        }

        // get latest app list
        const latestApps = useAppListStore.getState().apps;
        console.log('[AppDetail] current app list length:', latestApps.length);

        // check if target app exists
        const targetApp = latestApps.find(
          app => app.instance_id === instanceId
        );
        if (!targetApp) {
          console.error('[AppDetail] app not found:', instanceId);
          setInitError(t('errors.appNotFound'));
          return;
        }

        console.log('[AppDetail] found target app:', targetApp.display_name);

        // immediately set sidebar selected status
        selectItem('app', instanceId);

        // simplify app switch logic
        // only switch when current app does not match
        // avoid unnecessary validation calls
        if (!currentAppMatches) {
          try {
            await switchToSpecificApp(instanceId);
            console.log('[AppDetail] app switched successfully');
          } catch (switchError) {
            console.warn(
              '[AppDetail] app switch failed, but continue loading page:',
              switchError
            );
          }
        } else {
          console.log('[AppDetail] current app matched, no need to switch');
        }

        console.log('[AppDetail] app initialization completed');
      } catch (error) {
        console.error('[AppDetail] initialization failed:', error);
        setInitError(
          error instanceof Error
            ? error.message
            : t('errors.initializationFailed')
        );
      } finally {
        // ensure initialization state is cleared in all cases
        setIsInitializing(false);
      }
    };

    if (instanceId) {
      initializeApp();
    }
  }, [
    instanceId,
    apps.length,
    currentAppId,
    fetchApps,
    switchToSpecificApp,
    selectItem,
    t,
  ]);

  // clear sidebar selected status when page unmounts
  useEffect(() => {
    return () => {
      // check if current path is not app detail page
      const currentPath = window.location.pathname;
      if (!currentPath.startsWith('/apps/')) {
        selectItem(null, null);
      }
    };
  }, [selectItem]);

  // wrap handleSubmit, implement UI switch logic
  const handleSubmit = useCallback(
    async (message: string, files?: ChatUploadFile[]) => {
      try {
        // immediately set submit state to true
        setIsSubmitting(true);

        // immediately close welcome screen
        setIsWelcomeScreen(false);

        console.log('[AppDetail] UI state updated, start sending message');

        // call original handleSubmit, it will create conversation and send message
        await originalHandleSubmit(message, files);

        console.log(
          '[AppDetail] message sent successfully, waiting for route change'
        );
      } catch (error) {
        console.error('[AppDetail] send message failed:', error);

        // restore UI state when send message failed
        setIsSubmitting(false);
        setIsWelcomeScreen(true);
      }
    },
    [originalHandleSubmit, setIsWelcomeScreen]
  );

  // error state
  if (initError) {
    return (
      <div
        className={cn(
          'relative flex h-full w-full flex-col',
          'bg-stone-100 dark:bg-stone-800',
          'items-center justify-center'
        )}
      >
        <div className="text-center">
          <Blocks
            className={cn(
              'mx-auto mb-4 h-16 w-16',
              'text-stone-500 dark:text-stone-400'
            )}
          />
          <h2
            className={cn(
              'mb-2 font-serif text-xl font-semibold',
              'text-stone-700 dark:text-stone-300'
            )}
          >
            {t('errors.appLoadFailed')}
          </h2>
          <p
            className={cn(
              'mb-4 font-serif',
              'text-stone-500 dark:text-stone-400'
            )}
          >
            {initError}
          </p>
          <button
            onClick={() => router.push('/apps')}
            className={cn(
              'rounded-lg px-4 py-2 font-serif transition-colors',
              'bg-stone-200 text-stone-800 hover:bg-stone-300',
              'dark:bg-stone-700 dark:text-stone-200 dark:hover:bg-stone-600'
            )}
          >
            {t('buttons.backToMarket')}
          </button>
        </div>
      </div>
    );
  }

  // loading state - ensure at least 0.7 seconds
  if (
    !hasMinimumLoadTime ||
    isInitializing ||
    (isValidating && !isValidatingForMessage) ||
    !currentApp
  ) {
    return (
      <div
        className={cn(
          'relative flex h-full w-full flex-col',
          'bg-stone-100 dark:bg-stone-800',
          'items-center justify-center'
        )}
      >
        <div className="text-center">
          <Loader2
            className={cn(
              'mx-auto mb-4 h-8 w-8 animate-spin',
              'text-stone-500 dark:text-stone-400'
            )}
          />
          <p className={cn('font-serif', 'text-stone-500 dark:text-stone-400')}>
            {isInitializing
              ? t('status.loadingApp')
              : isValidating && !isValidatingForMessage
                ? t('status.validatingConfig')
                : t('status.loading')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative flex h-full w-full flex-col',
        'bg-stone-100 dark:bg-stone-800',
        'text-stone-900 dark:text-gray-100'
      )}
    >
      {/* Main content area with simplified layout */}
      <div
        className={cn(
          'relative flex min-h-0 flex-1 flex-col overflow-hidden',
          'pt-10'
        )}
        style={
          { '--chat-input-height': chatInputHeightVar } as React.CSSProperties
        }
      >
        {/* main content */}
        <div className="min-h-0 flex-1">
          {/* Simplified display logic using useWelcomeScreen */}
          {isWelcomeScreen && messages.length === 0 ? (
            <div
              className={cn(
                'h-full overflow-y-auto scroll-smooth',
                'mx-auto w-full',
                widthClass,
                paddingClass
              )}
            >
              <div className="py-8">
                <div className="mb-8">
                  <WelcomeScreen username={profile?.username} />
                </div>
              </div>
            </div>
          ) : (
            <div
              ref={scrollRef}
              className="chat-scroll-container h-full overflow-y-auto scroll-smooth"
            >
              <ChatLoader
                messages={messages}
                isWaitingForResponse={isWaitingForResponse}
                isLoadingInitial={false}
              />
            </div>
          )}
        </div>

        {/* scroll to bottom button */}
        <ScrollToBottomButton />

        {/* input box background */}
        <ChatInputBackdrop />

        {/* Chat input with simplified configuration */}
        <ChatInput
          onSubmit={handleSubmit}
          placeholder={t('startChatWith', {
            appName: currentApp.display_name || t('defaultApp'),
          })}
          isProcessing={isProcessing}
          isWaiting={isWaitingForResponse}
          onStop={handleStopProcessing}
          showModelSelector={false}
          requireModelValidation={false}
        />

        {/* Show dynamic suggested questions when on welcome screen with no messages */}
        {isWelcomeScreen && messages.length === 0 && (
          <DynamicSuggestedQuestions onQuestionClick={sendDirectMessage} />
        )}
      </div>
    </div>
  );
}
