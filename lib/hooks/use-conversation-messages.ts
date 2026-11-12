/**
 * Conversation messages loading hook
 * @description Provides paginated loading, history queries, and scroll loading for conversation messages
 *
 * @scope Only for conversation-type Dify applications (chatbot, agent, chatflow)
 * These applications store historical messages in conversations + messages tables
 *
 * Task-type applications (workflow, text-generation) store execution records in app_executions table
 * and do not use this hook for history loading
 *
 * Updated to use new unified data service and messageService
 */
import { getConversationByExternalId } from '@lib/services/client/conversations-api';
import { getMessagePage } from '@lib/services/client/messages-api';
import { useChatScrollStore } from '@lib/stores/chat-scroll-store';
import { useChatStore } from '@lib/stores/chat-store';

import { useCallback, useEffect, useRef, useState } from 'react';

import { usePathname } from 'next/navigation';

import {
  dbMessageToChatMessage,
  getConversationIdFromPath,
  shouldHandleScrollLoad,
  shouldLoadMoreMessages,
  shouldPreserveMessagesOnRouteTransition,
} from './use-conversation-messages/helpers';
import {
  type LoadingStatus,
  MESSAGES_PER_PAGE,
  createConversationLoaderState,
  createIdleLoadingStatus,
} from './use-conversation-messages/types';

export type { LoadingState } from './use-conversation-messages/types';

/**
 * Conversation messages loading hook
 * Provides paginated message loading functionality
 */
export function useConversationMessages() {
  const pathname = usePathname() ?? '';

  // Use unified loading state object for state management
  // Merge multiple state variables into one structured state object
  const [dbConversationId, setDbConversationId] = useState<string | null>(null);
  const [difyConversationId, setDifyConversationId] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState<LoadingStatus>(
    createIdleLoadingStatus()
  );
  const [hasMoreMessages, setHasMoreMessages] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  // Combine multiple refs into a single object for better maintainability
  const loaderState = useRef(createConversationLoaderState());

  // Get current message state and actions from chatStore
  const { clearMessages } = useChatStore();

  // Helper function to start loading
  const startLoading = useCallback((type: 'initial' | 'more') => {
    setError(null);
    setLoading(prev => ({ ...prev, state: 'loading', type, isLocked: true }));
  }, []);

  // Helper function to finish loading
  const finishLoading = useCallback(
    (state: 'success' | 'error' | 'complete' | 'idle') => {
      setLoading(prev => ({ ...prev, state, type: 'none', isLocked: false }));
    },
    []
  );

  // Cancel current request
  const cancelCurrentRequest = useCallback(() => {
    if (loaderState.current.abortController) {
      loaderState.current.abortController.abort();
      loaderState.current.abortController = null;
    }
  }, []);

  // Reset loader state
  const resetLoader = useCallback(() => {
    cancelCurrentRequest();
    loaderState.current.page = 1;
    loaderState.current.totalMessages = 0;
    loaderState.current.nextCursor = null;
    loaderState.current.currentId = null;
    setLoading(createIdleLoadingStatus());
    setError(null);
  }, [cancelCurrentRequest]);

  /**
   * Get the database conversation ID from the Dify conversation ID (using the new optimized interface)
   */
  const fetchDbConversationId = useCallback(async (externalId: string) => {
    try {
      console.log(
        `[useConversationMessages] Querying conversation record for external ID ${externalId}`
      );

      const result = await getConversationByExternalId(externalId);
      if (loaderState.current.currentId !== externalId) {
        return null;
      }

      if (result.success && result.data) {
        console.log(
          `[useConversationMessages] Found conversation record, db ID=${result.data.id}`
        );
        setDbConversationId(result.data.id);
        return result.data.id;
      } else if (result.success && !result.data) {
        console.log(
          `[useConversationMessages] No conversation record found for external ID ${externalId}`
        );
        setDbConversationId(null);
        return null;
      } else {
        console.error(
          `[useConversationMessages] Failed to query conversation record:`,
          result.error
        );
        setError(
          result.error || new Error('Failed to query conversation record')
        );
        setDbConversationId(null);
        return null;
      }
    } catch (error) {
      if (loaderState.current.currentId !== externalId) return null;
      console.error(
        `[useConversationMessages] Exception when querying conversation record:`,
        error
      );
      setError(error instanceof Error ? error : new Error(String(error)));
      setDbConversationId(null);
      return null;
    }
  }, []);

  /**
   * Load initial messages (using the new messageService)
   */
  const loadInitialMessages = useCallback(
    async (dbConvId: string) => {
      if (!dbConvId) {
        return;
      }

      // Get the scroll control function
      const resetScrollState = useChatScrollStore.getState().resetScrollState;

      // Cancel any ongoing requests
      cancelCurrentRequest();

      // Create a new AbortController
      const controller = new AbortController();
      loaderState.current.abortController = controller;
      const signal = controller.signal;

      try {
        // Set loading state
        startLoading('initial');
        loaderState.current.page = 1;
        loaderState.current.currentId = dbConvId;

        console.log(
          `[useConversationMessages] Start loading initial messages, db conversation ID=${dbConvId}`
        );

        // Before getting messages, clear the current messages to avoid old messages flickering
        // Keep the skeleton screen state until the new messages are fully loaded
        clearMessages();

        // Set the current database conversation ID
        setDbConversationId(dbConvId);

        // Use the new messageService to get the latest messages
        const result = await getMessagePage(dbConvId, {
          limit: MESSAGES_PER_PAGE,
        });

        // If the request has been cancelled or the conversation ID has changed, discard the result
        if (signal.aborted || loaderState.current.currentId !== dbConvId) {
          console.log(
            `[useConversationMessages] Request cancelled or conversation ID changed, discard loading result`
          );
          return;
        }

        if (!result.success) {
          console.error(
            `[useConversationMessages] Failed to load initial messages:`,
            result.error
          );
          setError(result.error);
          finishLoading('error');
          return;
        }

        const dbMessages = result.data.messages;
        loaderState.current.nextCursor = result.data.nextCursor;

        // Record the total number of messages
        loaderState.current.totalMessages = dbMessages.length;

        setHasMoreMessages(result.data.hasMore);

        if (dbMessages.length === 0) {
          console.log(
            `[useConversationMessages] No historical messages in conversation`
          );
          finishLoading('complete');
          return;
        }

        // Convert database messages to frontend message objects
        const chatMessages = dbMessages.map(dbMessageToChatMessage);

        console.log(
          `[useConversationMessages] Loaded ${dbMessages.length} latest messages`
        );

        // Optimize state update logic to ensure the skeleton screen disappears and new messages are displayed directly, avoiding flickering
        // 1. First batch add messages to the store
        // 2. Use requestAnimationFrame to ensure the DOM is updated
        // 3. Then set the loading state to success and close the skeleton screen
        useChatStore.setState({ messages: chatMessages });

        // Use requestAnimationFrame to ensure the DOM is updated before
        requestAnimationFrame(() => {
          if (signal.aborted || loaderState.current.currentId !== dbConvId)
            return;
          // Ensure the scroll is at the bottom, using a reliable method
          resetScrollState();

          // Use requestAnimationFrame again to ensure the above operation is completed
          requestAnimationFrame(() => {
            if (signal.aborted || loaderState.current.currentId !== dbConvId)
              return;
            // Set the loading success state
            finishLoading('success');
          });
        });
      } catch (error) {
        // If the error is caused by cancellation of the request, do not process it
        if (signal.aborted) return;

        console.error(
          `[useConversationMessages] Failed to load initial messages:`,
          error
        );
        setError(error instanceof Error ? error : new Error(String(error)));
        finishLoading('error');
      } finally {
        if (loaderState.current.abortController === controller) {
          loaderState.current.abortController = null;
        }
      }
    },
    [clearMessages, cancelCurrentRequest, finishLoading, startLoading]
  );

  /**
   * Load more historical messages (using the new messageService)
   */
  const loadMoreMessages = useCallback(async () => {
    if (
      loaderState.current.abortController ||
      !shouldLoadMoreMessages({
        dbConversationId,
        hasMoreMessages,
        loading,
      })
    ) {
      return;
    }
    const activeConversationId = dbConversationId;
    const beforeMessageId = loaderState.current.nextCursor;
    if (!activeConversationId || !beforeMessageId) {
      return;
    }

    // Cancel any ongoing requests
    cancelCurrentRequest();

    // Create a new AbortController
    const controller = new AbortController();
    loaderState.current.abortController = controller;
    const signal = controller.signal;

    try {
      // Set loading state
      // Only set the state type to 'more' when loading more messages
      startLoading('more');

      const currentPage = loaderState.current.page;

      console.log(
        `[useConversationMessages] Loading more historical messages, page=${currentPage + 1}`
      );

      const result = await getMessagePage(activeConversationId, {
        limit: MESSAGES_PER_PAGE,
        beforeMessageId,
      });

      // If the request has been cancelled or the conversation ID has changed, discard the result
      if (
        signal.aborted ||
        loaderState.current.currentId !== activeConversationId
      ) {
        console.log(
          `[useConversationMessages] Request cancelled or conversation ID changed, discard loading more result`
        );
        return;
      }

      if (!result.success) {
        console.error(
          `[useConversationMessages] Failed to load more messages:`,
          result.error
        );
        setError(result.error);
        finishLoading('error');
        return;
      }

      const pageMessages = result.data.messages;
      loaderState.current.totalMessages += pageMessages.length;
      loaderState.current.nextCursor = result.data.nextCursor;
      setHasMoreMessages(result.data.hasMore);

      // Record the current scroll position
      const scrollContainer = messagesContainerRef.current;
      const oldScrollHeight = scrollContainer?.scrollHeight || 0;
      const oldScrollTop = scrollContainer?.scrollTop || 0;

      // Convert database messages to frontend message objects
      const newChatMessages = pageMessages.map(dbMessageToChatMessage);

      // Current messages
      const currentMessages = useChatStore.getState().messages;

      // Batch add to the existing messages
      const existingIds = new Set(
        currentMessages.map(message => message.db_id)
      );
      const updatedMessages = [
        ...newChatMessages.filter(message => !existingIds.has(message.db_id)),
        ...currentMessages,
      ];
      useChatStore.setState({ messages: updatedMessages });

      // Increase the page number
      loaderState.current.page = currentPage + 1;

      console.log(
        `[useConversationMessages] Loaded ${pageMessages.length} historical messages`
      );

      // After loading, reset the loading state
      finishLoading('success');

      // Keep the scroll position, using a more reliable method
      if (scrollContainer) {
        // Use requestAnimationFrame to ensure that the DOM is updated
        requestAnimationFrame(() => {
          if (
            signal.aborted ||
            loaderState.current.currentId !== activeConversationId
          )
            return;
          if (scrollContainer) {
            // Calculate the difference in height
            const newScrollHeight = scrollContainer.scrollHeight;
            const heightDiff = newScrollHeight - oldScrollHeight;

            // Adjust the scroll position
            if (heightDiff > 0) {
              scrollContainer.scrollTop = oldScrollTop + heightDiff;
              console.log(
                `[useConversationMessages] Adjust scroll position: ${oldScrollTop} -> ${oldScrollTop + heightDiff}`
              );
            }
          }
        });
      }
    } catch (error) {
      // If the error is caused by cancellation of the request, do not process it
      if (signal.aborted) {
        return;
      }

      console.error(
        `[useConversationMessages] Failed to load more historical messages:`,
        error
      );
      setError(error instanceof Error ? error : new Error(String(error)));
      finishLoading('error');
    } finally {
      if (loaderState.current.abortController === controller) {
        loaderState.current.abortController = null;
      }
    }
  }, [
    dbConversationId,
    loading,
    hasMoreMessages,
    cancelCurrentRequest,
    finishLoading,
    startLoading,
  ]);

  /**
   * Set the message container reference, used for scroll detection
   */
  const setMessagesContainer = useCallback((element: HTMLDivElement | null) => {
    messagesContainerRef.current = element;
  }, []);

  /**
   * Check if the scroll is at the top, and automatically load more messages
   */
  const handleScroll = useCallback(() => {
    // Use the unified state object to check if more messages can be loaded
    if (
      !messagesContainerRef.current ||
      !hasMoreMessages ||
      loading.state === 'loading' ||
      loading.isLocked
    ) {
      return;
    }

    if (
      shouldHandleScrollLoad({
        hasMoreMessages,
        loading,
        scrollTop: messagesContainerRef.current.scrollTop,
      })
    ) {
      loadMoreMessages();
    }
  }, [hasMoreMessages, loading, loadMoreMessages]);

  // The function to reset the loading state is provided by the resetLoader function
  // No need to use the resetLoadingState function separately

  /**
   * Load messages when route changes
   */
  useEffect(() => {
    const externalId = getConversationIdFromPath(pathname);
    const currentMessages = useChatStore.getState().messages;
    const isFirstMessageTransition = shouldPreserveMessagesOnRouteTransition({
      currentMessages,
      externalId,
      previousPath: loaderState.current.previousPath,
    });
    const isFromNewChat =
      loaderState.current.previousPath === '/chat/new' ||
      (loaderState.current.previousPath?.includes('/chat/temp-') ?? false);
    const isToExistingChat =
      externalId && externalId !== 'new' && !externalId.includes('temp-');
    const hasExistingMessages = currentMessages.length > 0;

    // Record the current path for next judgment
    loaderState.current.previousPath = pathname;

    console.log(
      `[useConversationMessages] Route change detection: isFirstSend=${isFirstMessageTransition}, from=${isFromNewChat}, to=${isToExistingChat}, messageCount=${hasExistingMessages}`
    );

    // Get the scroll control function
    const resetScrollState = useChatScrollStore.getState().resetScrollState;

    // Cancel any ongoing requests
    cancelCurrentRequest();

    // If the route change is caused by the first message sent, skip clearing and loading messages
    if (isFirstMessageTransition) {
      console.log(
        `[useConversationMessages] Route change caused by first message sent, keep existing messages`
      );
      // Skip resetting state and clearing messages, directly set loading to complete
      finishLoading('success');

      setHasMoreMessages(false);

      // Ensure the scroll is at the bottom
      resetScrollState();
      return;
    }

    // For non-first message route changes, execute normal loading logic
    // OPTIMIZATION: Prioritize UI responsiveness over heavy operations
    // 1. Reset loader state immediately
    // 2. Set loading state immediately (shows skeleton)
    // 3. Defer heavy operations to avoid blocking sidebar highlight updates
    resetLoader();

    // Immediately set loading state - this shows skeleton and gives visual feedback
    startLoading('initial');

    // Defer heavy operations to next tick to avoid blocking sidebar highlight updates
    // This ensures sidebar responds immediately while content loading happens in background
    const routeFrame = requestAnimationFrame(() => {
      if (loaderState.current.currentId !== externalId) return;
      clearMessages();
      resetScrollState();
    });

    if (externalId) {
      setDifyConversationId(externalId);

      // Set the current loaded conversation ID in the unified state object
      loaderState.current.currentId = externalId;

      // Get the database conversation ID and load messages
      (async () => {
        // Try to query the database conversation ID
        const dbConvId = await fetchDbConversationId(externalId);

        // Ensure that the current path is still the requested conversation
        if (loaderState.current.currentId === externalId && dbConvId) {
          // Set the current database conversation ID
          loaderState.current.currentId = dbConvId;
          // Load initial messages
          loadInitialMessages(dbConvId);
        } else if (loaderState.current.currentId === externalId) {
          // If the database conversation ID is not found, set the completion state
          finishLoading('complete');
        }
      })();
    } else {
      // Clean up state if not a conversation page
      setDifyConversationId(null);
      setDbConversationId(null);
      setHasMoreMessages(true);
      resetLoader();
    }

    // Clean up function
    const loaderStateForCleanup = loaderState.current;
    return () => {
      cancelAnimationFrame(routeFrame);
      // Clean up loading state
      // If the component is unmounted or the route changes, mark the current loaded ID as null
      // This can be used to know that the context has changed after the asynchronous operation is completed
      loaderStateForCleanup.currentId = null;

      // Cancel any ongoing requests
      cancelCurrentRequest();
    };
  }, [
    pathname,
    fetchDbConversationId,
    loadInitialMessages,
    resetLoader,
    clearMessages,
    cancelCurrentRequest,
    finishLoading,
    startLoading,
  ]);

  /**
   * Add and remove scroll event listeners
   */
  useEffect(() => {
    const messagesContainer = messagesContainerRef.current;
    if (messagesContainer) {
      messagesContainer.addEventListener('scroll', handleScroll);
    }

    return () => {
      if (messagesContainer) {
        messagesContainer.removeEventListener('scroll', handleScroll);
      }
    };
  }, [handleScroll]);

  return {
    dbConversationId,
    difyConversationId,
    loading,
    hasMoreMessages,
    error,
    loadMoreMessages,
    setMessagesContainer,
    // Export some useful states
    isLoading: loading.state === 'loading',
    // Use the unified loading state object to infer the initial loading and load more states
    // This can more accurately control the display timing of the skeleton screen, avoiding flickering issues
    isLoadingInitial: loading.state === 'loading' && loading.type === 'initial',
    isLoadingMore: loading.state === 'loading' && loading.type === 'more',
  };
}
