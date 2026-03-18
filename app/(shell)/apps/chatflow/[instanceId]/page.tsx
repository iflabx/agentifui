'use client';

import {
  ChatInputBackdrop,
  ChatLoader,
  ScrollToBottomButton,
} from '@components/chat';
import { ChatInput } from '@components/chat-input';
import { ChatflowFloatingController } from '@components/chatflow/chatflow-floating-controller';
import { ChatflowInputArea } from '@components/chatflow/chatflow-input-area';
import { ChatflowNodeTracker } from '@components/chatflow/chatflow-node-tracker';
import { useChatInterface, useChatScroll, useWelcomeScreen } from '@lib/hooks';
import { useChatflowInterface } from '@lib/hooks/use-chatflow-interface';
import { useChatflowState } from '@lib/hooks/use-chatflow-state';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import type { ChatUploadFile } from '@lib/services/dify/types';
import { useAppListStore } from '@lib/stores/app-list-store';
import { useChatLayoutStore } from '@lib/stores/chat-layout-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';
import { Blocks, Loader2 } from 'lucide-react';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import { useParams, usePathname, useRouter } from 'next/navigation';

export default function AppDetailPage() {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const instanceId = params.instanceId as string;
  const t = useTranslations('pages.apps');

  // get chatflow execution state cleanup method
  const { resetExecution } = useChatflowExecutionStore();

  // use unified chatflow state management, support intelligent popup control
  const {
    messages,
    handleSubmit: originalHandleSubmit,
    isProcessing,
    handleStopProcessing,
    showNodeTracker,
    setShowNodeTracker,
    showFloatingController,
  } = useChatflowState(true); // chatflow page is always a chatflow application

  // get chatflow-specific submission function
  const { handleChatflowSubmit, isWaitingForResponse } = useChatflowInterface();

  // use unified welcome interface logic, now support app detail page
  const { isWelcomeScreen, setIsWelcomeScreen } = useWelcomeScreen();

  // get chat layout state, used for input box height management
  const { inputHeight } = useChatLayoutStore();
  const chatInputHeightVar = `${inputHeight || 80}px`;

  // local state management
  const [, setIsSubmitting] = useState(false);

  // remove duplicate automatic display logic, now managed by useChatflowState
  // Support intelligent behavior where users can manually close and no longer automatically open
  // add scroll management, ensure message list can scroll correctly
  const scrollRef = useChatScroll(messages);

  // sidebar selected state management
  const { selectItem } = useSidebarStore();

  // chat state management
  const { clearMessages, setCurrentConversationId } = useChatStore();

  // app initialization state
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  // track form configuration state for chatflow
  const [, setHasFormConfig] = useState(false);

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
    // correctly determine if the current page is a chatflow page
    if (pathname === `/apps/chatflow/${instanceId}`) {
      console.log(
        '[AppDetail] route changed to app detail page, clear chat state immediately'
      );

      // Immediately clear all messages
      useChatStore.getState().clearMessages();
      clearMessages();

      // Set current conversation ID to null
      setCurrentConversationId(null);

      // clean up conversation state in use-chat-interface
      // ensure difyConversationId, dbConversationUUID, conversationAppId are correctly cleared
      clearConversationState();

      // force welcome screen state to true
      setIsWelcomeScreen(true);

      // reset submission state
      setIsSubmitting(false);

      // clean up chatflow execution state, ensuring previous node data is not displayed
      resetExecution();

      console.log('[AppDetail] Chat state cleanup completed');
    }
  }, [
    pathname,
    instanceId,
    clearMessages,
    setCurrentConversationId,
    setIsWelcomeScreen,
    resetExecution,
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

        // get latest app list
        const latestApps = useAppListStore.getState().apps;
        console.log(
          '[AppDetail] Current application list length:',
          latestApps.length
        );

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

        // immediately set sidebar selected state
        selectItem('app', instanceId);

        // simplify app switch logic
        // only switch when current app does not match
        // avoid unnecessary validation calls
        if (!currentAppMatches) {
          console.log(
            '[AppDetail] need to switch app, from',
            currentAppId,
            'to',
            instanceId
          );

          // use simpler switching logic, avoid complex validation
          try {
            await switchToSpecificApp(instanceId);
            console.log('[AppDetail] app switched successfully');
          } catch (switchError) {
            console.warn(
              '[AppDetail] app switching failed, but continue loading page:',
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

  // when page is unloaded, clear the selected state (when leaving the app detail page)
  useEffect(() => {
    return () => {
      // check if app detail page has been left
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
        // immediately set the submission state to true
        setIsSubmitting(true);

        // immediately close the welcome interface
        setIsWelcomeScreen(false);

        console.log('[AppDetail] UI state updated, start sending message');

        // call the original handleSubmit, it will create a conversation and send a message
        await originalHandleSubmit(message, files);

        console.log(
          '[AppDetail] Message sent successfully, waiting for route jump'
        );
      } catch (error) {
        console.error('[AppDetail] Message sending failed:', error);

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
                'mx-auto w-full'
              )}
            >
              <div className="py-8">
                <ChatflowInputArea
                  instanceId={instanceId}
                  onSubmit={handleChatflowSubmit}
                  isProcessing={isProcessing}
                  isWaiting={isWaitingForResponse}
                  onFormConfigChange={setHasFormConfig}
                />
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

              <ChatflowNodeTracker
                isVisible={showNodeTracker}
                className={cn(
                  'fixed right-4 bottom-40 z-30 max-w-sm',
                  'transition-all duration-300'
                )}
              />
            </div>
          )}
        </div>

        <ScrollToBottomButton />

        <ChatflowFloatingController
          isVisible={showFloatingController}
          isTrackerVisible={showNodeTracker}
          onToggleTracker={() => setShowNodeTracker(!showNodeTracker)}
        />

        {!isWelcomeScreen && (
          <>
            <ChatInputBackdrop />

            <ChatInput
              onSubmit={handleSubmit}
              placeholder={t('continueChatWith', {
                appName: currentApp.display_name || t('defaultApp'),
              })}
              isProcessing={isProcessing}
              isWaiting={isWaitingForResponse}
              onStop={handleStopProcessing}
              showModelSelector={false}
              requireModelValidation={false}
            />
          </>
        )}
      </div>
    </div>
  );
}
