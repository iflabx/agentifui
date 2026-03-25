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
import { getLatestMessages } from '@lib/services/client/messages-api';
import { useChatScrollStore } from '@lib/stores/chat-scroll-store';
import { useChatStore } from '@lib/stores/chat-store';

import { useCallback, useEffect, useRef, useState } from 'react';

import { usePathname } from 'next/navigation';

import {
  dbMessageToChatMessage,
  getConversationIdFromPath,
  organizeMessages,
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
      // Prevent duplicate loading or loading a changed conversation
      // Use the unified loading state object to check if loading is in progress
      if (!dbConvId || loading.isLocked) {
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
        const result = await getLatestMessages(dbConvId, MESSAGES_PER_PAGE);

        // If the request has been cancelled or the conversation ID has changed, discard the result
        if (signal.aborted || loaderState.current.currentId !== dbConvId) {
          console.log(
            `[useConversationMessages] Request cancelled or conversation ID changed, discard loading result`
          );
          finishLoading('idle'); // Reset the loading state
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

        const dbMessages = result.data;

        // Record the total number of messages
        loaderState.current.totalMessages = dbMessages.length;

        // If the total number of messages is less than one page, no need to show "Load more" button
        if (dbMessages.length <= MESSAGES_PER_PAGE) {
          setHasMoreMessages(false);
        } else {
          setHasMoreMessages(true);
        }

        if (dbMessages.length === 0) {
          console.log(
            `[useConversationMessages] No historical messages in conversation`
          );
          finishLoading('complete');
          return;
        }

        // Sort by time and organize message order
        const organizedMessages = organizeMessages(dbMessages);

        // Get the last MESSAGES_PER_PAGE messages
        const latestMessages = organizedMessages.slice(-MESSAGES_PER_PAGE);

        // Convert database messages to frontend message objects
        const chatMessages = latestMessages.map(dbMessageToChatMessage);

        console.log(
          `[useConversationMessages] Loaded ${latestMessages.length} latest messages`
        );

        // Optimize state update logic to ensure the skeleton screen disappears and new messages are displayed directly, avoiding flickering
        // 1. First batch add messages to the store
        // 2. Use requestAnimationFrame to ensure the DOM is updated
        // 3. Then set the loading state to success and close the skeleton screen
        useChatStore.setState({ messages: chatMessages });

        // Use requestAnimationFrame to ensure the DOM is updated before
        requestAnimationFrame(() => {
          // Ensure the scroll is at the bottom, using a reliable method
          resetScrollState();

          // Use requestAnimationFrame again to ensure the above operation is completed
          requestAnimationFrame(() => {
            // Set the loading success state
            finishLoading('success');

            // Record that this conversation has been loaded successfully to avoid duplicate loading
            if (dbConvId) {
              loaderState.current.loadedConversations.add(dbConvId);

              // Get the conversation ID in the current path
              const pathConversationId = getConversationIdFromPath(pathname);
              if (
                pathConversationId &&
                pathConversationId !== 'new' &&
                !pathConversationId.includes('temp-')
              ) {
                loaderState.current.loadedConversations.add(pathConversationId);
              }
            }
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
      }
    },
    [
      clearMessages,
      organizeMessages,
      cancelCurrentRequest,
      finishLoading,
      loading.isLocked,
      pathname,
      startLoading,
    ]
  );

  /**
   * Load more historical messages (using the new messageService)
   */
  const loadMoreMessages = useCallback(async () => {
    if (
      !shouldLoadMoreMessages({
        dbConversationId,
        hasMoreMessages,
        loading,
      })
    ) {
      return;
    }
    const activeConversationId = dbConversationId;
    if (!activeConversationId) {
      return;
    }

    // Record the current scroll position to prevent the scroll position from being lost after loading

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

      // Calculate the number
      const currentPage = loaderState.current.page;
      const skip = currentPage * MESSAGES_PER_PAGE;

      console.log(
        `[useConversationMessages] Loading more historical messages, page=${currentPage + 1}, skip=${skip}`
      );

      // Use the new messageService to get all messages, then manually paginate
      // This is a temporary solution, and the real cursor pagination can be optimized later
      const result = await getLatestMessages(activeConversationId, 1000);

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

      const allMessages = result.data;

      // Update the total number of messages
      loaderState.current.totalMessages = allMessages.length;

      // If all messages have been loaded
      if (skip >= allMessages.length) {
        setHasMoreMessages(false);
        finishLoading('complete');
        console.log(`[useConversationMessages] No more historical messages`);
        return;
      }

      // Sort by time and organize message order
      const organizedMessages = organizeMessages(allMessages);

      // Get the messages on the current page
      const endIndex = Math.max(0, organizedMessages.length - skip);
      const startIndex = Math.max(0, endIndex - MESSAGES_PER_PAGE);
      const pageMessages = organizedMessages.slice(startIndex, endIndex);

      // Check if there are more messages to load
      if (startIndex === 0) {
        setHasMoreMessages(false);
        // If there are no more messages, set the loading state to complete
        finishLoading('complete');
      }

      // Record the current scroll position
      const scrollContainer = messagesContainerRef.current;
      const oldScrollHeight = scrollContainer?.scrollHeight || 0;
      const oldScrollTop = scrollContainer?.scrollTop || 0;

      // Convert database messages to frontend message objects
      const newChatMessages = pageMessages.map(dbMessageToChatMessage);

      // Current messages
      const currentMessages = useChatStore.getState().messages;

      // Batch add to the existing messages
      const updatedMessages = [...newChatMessages, ...currentMessages];
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
      // Unlock the loading state
      finishLoading('idle');
    }
  }, [
    dbConversationId,
    loading,
    hasMoreMessages,
    organizeMessages,
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

      // Record that this conversation has been loaded successfully to avoid duplicate loading
      if (externalId) {
        loaderState.current.loadedConversations.add(externalId);
      }

      // Ensure the scroll is at the bottom
      resetScrollState();
      return;
    }

    // Check if this conversation has already been loaded
    if (externalId && loaderState.current.loadedConversations.has(externalId)) {
      console.log(
        `[useConversationMessages] Conversation ${externalId} already loaded, skip duplicate loading`
      );
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
    requestAnimationFrame(() => {
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
      // Clean up loading state
      // If the component is unmounted or the route changes, mark the current loaded ID as null
      // This can be used to know that the context has changed after the asynchronous operation is completed
      if (loaderStateForCleanup.currentId === externalId) {
        loaderStateForCleanup.currentId = null;
      }

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
