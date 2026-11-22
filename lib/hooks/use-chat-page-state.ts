import { useChatStore } from '@lib/stores/chat-store';
import { useChatTransitionStore } from '@lib/stores/chat-transition-store';
import { useSidebarStore } from '@lib/stores/sidebar-store';

import { useCallback, useLayoutEffect, useState } from 'react';

import { useChatStateSync } from './use-chat-state-sync';

/**
 * Chat page state management hook.
 *
 * Centralizes chat page state management to reduce state logic in page components.
 */
export function useChatPageState(conversationIdFromUrl: string | undefined) {
  // Get necessary state and methods from useChatStore
  const setCurrentConversationId = useChatStore(
    state => state.setCurrentConversationId
  );
  const clearMessages = useChatStore(state => state.clearMessages);

  // Get welcome screen state and setter from useChatStateSync
  const { isWelcomeScreen, setIsWelcomeScreen } = useChatStateSync();

  // Local state for submit status
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get transition state from global store
  const { isTransitioningToWelcome, setIsTransitioningToWelcome } =
    useChatTransitionStore();

  // Get sidebar selection method from sidebar store
  // Used to ensure sidebar selection state syncs with route changes
  const selectItem = useSidebarStore(state => state.selectItem);

  // Use useLayoutEffect to handle URL param changes and reduce flicker
  // Compared to useEffect, useLayoutEffect runs synchronously before browser paint
  // This helps reduce flicker of the welcome page
  useLayoutEffect(() => {
    // If the conversationId in the URL is 'new', set to null, clear messages, and show welcome screen
    if (conversationIdFromUrl === 'new') {
      console.log(
        '[ChatPageState] Detected new route, clearing messages and showing welcome screen'
      );

      // Force clear all messages
      useChatStore.getState().clearMessages();
      clearMessages();

      // Set current conversation ID to null
      setCurrentConversationId(null);

      // Sync sidebar selection state to null
      selectItem('chat', null, true);

      // Force set welcome screen state to true
      setIsWelcomeScreen(true);

      // Reset submit state
      setIsSubmitting(false);

      // Set transition state to indicate transition from chat to welcome screen
      setIsTransitioningToWelcome(true);
    } else if (conversationIdFromUrl) {
      // Check if this is a temporary ID
      const isTempId = conversationIdFromUrl.startsWith('temp-');

      console.log(
        `[ChatPageState] Set conversation ID: ${conversationIdFromUrl}${isTempId ? ' (temp ID)' : ''}`
      );

      // Set current conversation ID
      setCurrentConversationId(conversationIdFromUrl);

      // Sync sidebar selection state
      selectItem('chat', conversationIdFromUrl, true);

      // Close welcome screen - force set to false to ensure it doesn't show after refresh
      setIsWelcomeScreen(false);

      // Not a transition from chat to welcome screen
      setIsTransitioningToWelcome(false);

      // Force refresh message state to ensure correct display after refresh
      setTimeout(() => {
        // Ensure welcome screen is closed again to avoid showing after refresh
        setIsWelcomeScreen(false);

        // Ensure current conversation ID and sidebar selection state are consistent
        if (
          useChatStore.getState().currentConversationId !==
          conversationIdFromUrl
        ) {
          setCurrentConversationId(conversationIdFromUrl);
        }

        // Ensure sidebar selection state is correct
        const sidebarState = useSidebarStore.getState();
        if (
          sidebarState.selectedId !== conversationIdFromUrl ||
          sidebarState.selectedType !== 'chat'
        ) {
          selectItem('chat', conversationIdFromUrl, true);
        }
      }, 50);
    } else {
      // If there is no conversationId, set to null
      setCurrentConversationId(null);

      // Sync sidebar selection state to null
      selectItem('chat', null, true);
    }
  }, [
    conversationIdFromUrl,
    setCurrentConversationId,
    setIsWelcomeScreen,
    clearMessages,
    setIsTransitioningToWelcome,
    selectItem,
  ]);

  // Wrap handleSubmit function
  // Ensure sidebar selection state is correctly synced when submitting a message
  const wrapHandleSubmit = useCallback(
    (
      originalHandleSubmit: (
        message: string,
        files?: unknown[],
        inputs?: Record<string, unknown>,
        editSourceId?: string
      ) => Promise<unknown>
    ) => {
      return async (
        message: string,
        files?: unknown[],
        editSourceId?: string
      ) => {
        // Immediately set submitting state to true
        setIsSubmitting(true);
        // Immediately close welcome screen
        setIsWelcomeScreen(false);
        // Not a transition from chat to welcome screen, use slide effect
        setIsTransitioningToWelcome(false);

        // Determine if this is a new conversation flow
        // If it's a new conversation or temp ID, need to clear message history
        const urlIndicatesNew =
          window.location.pathname === '/chat/new' ||
          window.location.pathname.includes('/chat/temp-');
        const currentConvId = useChatStore.getState().currentConversationId;
        const isNewConversationFlow = urlIndicatesNew && !currentConvId;

        if (isNewConversationFlow) {
          console.log(
            '[ChatPageState] Detected new chat route and no current conversation ID, clearing messages'
          );
          clearMessages();
        } else if (currentConvId) {
          console.log(
            `[ChatPageState] Using existing conversation: ${currentConvId}`
          );

          // Ensure sidebar selection state is synced with current conversation ID
          // Keep current expansion state
          selectItem('chat', currentConvId, true);
        }

        // Call the original handleSubmit function
        const result = await originalHandleSubmit(
          message,
          files,
          undefined,
          editSourceId
        );

        // If it's a new conversation, a temp ID may be created after submit
        // Need to ensure sidebar selection state is synced with current conversation ID again
        const newConvId = useChatStore.getState().currentConversationId;
        if (newConvId && newConvId !== currentConvId) {
          console.log(
            `[ChatPageState] Updated conversation ID after submit: ${newConvId}`
          );
          selectItem('chat', newConvId, true);
        }

        return result;
      };
    },
    [setIsWelcomeScreen, clearMessages, selectItem, setIsTransitioningToWelcome]
  );

  return {
    isWelcomeScreen,
    isSubmitting,
    isTransitioningToWelcome,
    wrapHandleSubmit,
  };
}
