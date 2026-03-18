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

  // get chat layout state, used for input box height management
  const { inputHeight } = useChatLayoutStore();
  const chatInputHeightVar = `${inputHeight || 80}px`;

  // local state management
  const [, setIsSubmitting] = useState(false);

  // add scroll management, ensure message list can scroll correctly
  const scrollRef = useChatScroll(messages);

  // sidebar selected state management
  const { selectItem } = useSidebarStore();

  // chat state management
  const { clearMessages, setCurrentConversationId } = useChatStore();

  // app initialization state
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // ensure loader displays for at least 0.7 seconds, allowing layout to stabilize
  const [hasMinimumLoadTime, setHasMinimumLoadTime] = useState(false);

  // ensure loader displays for at least 0.7 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setHasMinimumLoadTime(true);
    }, 700); // 0.7 seconds

    return () => clearTimeout(timer);
  }, []);

  // app-related state
  const { apps, fetchApps } = useAppListStore();
  const {
    currentAppId,
    isValidating,
    isValidatingForMessage,
    switchToSpecificApp,
  } = useCurrentApp();

  // get current app instance data
  const currentApp = apps.find(app => app.instance_id === instanceId);

  // useLayoutEffect ensures immediate cleanup of state when switching routes
  // this executes earlier than useEffect, allowing state to be cleared before rendering, avoiding display of incorrect content
  const { clearConversationState } = useChatInterface();

  useLayoutEffect(() => {
    // correctly determine if the current page is an agent page
    if (pathname === `/apps/agent/${instanceId}`) {
      console.log(
        '[AppDetail] Route switched to agent page, immediately clean up chat state'
      );

      // immediately clear all messages
      useChatStore.getState().clearMessages();
      clearMessages();

      // set current conversation ID to null
      setCurrentConversationId(null);

      // clean up conversation state in use-chat-interface
      // This ensures that difyConversationId, dbConversationUUID, and conversationAppId are correctly cleared
      clearConversationState();

      // force welcome screen state to true
      setIsWelcomeScreen(true);

      // reset submission state
      setIsSubmitting(false);

      console.log('[AppDetail] Chat state cleanup completed');
    }
  }, [
    pathname,
    instanceId,
    clearMessages,
    setCurrentConversationId,
    setIsWelcomeScreen,
    clearConversationState,
  ]);

  // page initialization: switch to target app and synchronize sidebar selected state
  // simplify initialization logic, avoid validation bounce, improve user experience
  useEffect(() => {
    const initializeApp = async () => {
      if (!instanceId) return;

      try {
        setInitError(null);

        console.log(
          '[AppDetail] Starting to initialize application:',
          instanceId
        );

        // simplify loading state check
        // only display loading state when truly needed
        const needsAppListFetch = apps.length === 0;
        const currentAppMatches = currentAppId === instanceId;

        // if app list is empty, need to fetch
        if (needsAppListFetch) {
          setIsInitializing(true);
          console.log(
            '[AppDetail] Application list is empty, starting to fetch'
          );
          await fetchApps();
        }

        // re-fetch the latest app list
        const latestApps = useAppListStore.getState().apps;
        console.log(
          '[AppDetail] Current application list length:',
          latestApps.length
        );

        // check if the app exists
        const targetApp = latestApps.find(
          app => app.instance_id === instanceId
        );
        if (!targetApp) {
          console.error('[AppDetail] Application does not exist:', instanceId);
          setInitError(t('errors.appNotFound'));
          return;
        }

        console.log(
          '[AppDetail] Found target application:',
          targetApp.display_name
        );

        // immediately set sidebar selected state
        selectItem('app', instanceId);

        // simplify app switching logic
        // only switch when the current app does not match
        // avoid unnecessary validation calls
        if (!currentAppMatches) {
          console.log(
            '[AppDetail] Need to switch application, from',
            currentAppId,
            'to',
            instanceId
          );

          // use simpler switching logic, avoid complex validation
          try {
            await switchToSpecificApp(instanceId);
            console.log('[AppDetail] Application switched successfully');
          } catch (switchError) {
            console.warn(
              '[AppDetail] Application switching failed, but continue to load page:',
              switchError
            );
            // even if switching fails, do not block page loading
            // the page can still be displayed normally, and the user can still use it
          }
        } else {
          console.log(
            '[AppDetail] Current application already matches, no need to switch'
          );
        }

        console.log('[AppDetail] Application initialization completed');
      } catch (error) {
        console.error('[AppDetail] Initialization failed:', error);
        setInitError(
          error instanceof Error
            ? error.message
            : t('errors.initializationFailed')
        );
      } finally {
        // ensure that the initialization state is cleared in all cases
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

  // when the page is unloaded, clear the selected state (when leaving the app detail page)
  useEffect(() => {
    return () => {
      // check if the app detail page has been left
      const currentPath = window.location.pathname;
      if (!currentPath.startsWith('/apps/')) {
        selectItem(null, null);
      }
    };
  }, [selectItem]);

  // wrap handleSubmit, implement UI switching logic
  const handleSubmit = useCallback(
    async (message: string, files?: ChatUploadFile[]) => {
      try {
        // simplify UI switching logic: immediately respond to user operations
        // immediately set submission state to true
        setIsSubmitting(true);

        // immediately close the welcome interface
        setIsWelcomeScreen(false);

        console.log('[AppDetail] UI state updated, starting to send message');

        // call the original handleSubmit, it will create a conversation and send a message
        await originalHandleSubmit(message, files);

        console.log(
          '[AppDetail] Message sent successfully, waiting for route jump'
        );
      } catch (error) {
        console.error('[AppDetail] Message sending failed:', error);

        // when sending fails, restore the UI state
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

  // loading state - ensure at least 0.7 seconds are displayed
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
      <div
        className={cn(
          'relative flex min-h-0 flex-1 flex-col overflow-hidden',
          'pt-10'
        )}
        style={
          { '--chat-input-height': chatInputHeightVar } as React.CSSProperties
        }
      >
        <div className="min-h-0 flex-1">
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

        <ScrollToBottomButton />

        <ChatInputBackdrop />

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

        {isWelcomeScreen && messages.length === 0 && (
          <DynamicSuggestedQuestions onQuestionClick={sendDirectMessage} />
        )}
      </div>
    </div>
  );
}
