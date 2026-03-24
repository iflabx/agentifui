import { useChatInputStore } from '@lib/stores/chat-input-store';

import { useCallback } from 'react';

import { usePathname } from 'next/navigation';

import { useChatInterface } from './use-chat-interface';

/**
 * Hook to determine if the current screen should display the welcome screen.
 *
 * The welcome screen is shown if:
 * 1. The current path is /chat/new, or
 * 2. The current path is /apps/{type}/[instanceId] (app detail page), or
 * 3. isWelcomeScreen state is true and messages array is empty,
 * 4. And there is no conversation ID in the path.
 */
export function useWelcomeScreen() {
  const { isWelcomeScreen, setIsWelcomeScreen: setStoreWelcomeScreen } =
    useChatInputStore();
  const { messages } = useChatInterface();
  const pathname = usePathname() ?? '';

  // Logic for determining welcome screen:
  // 1. If path is /chat/new, always show welcome screen
  // 2. If path is /apps/{type}/[instanceId], show welcome screen (when no messages)
  // 3. If path contains a conversation ID, never show welcome screen
  // 4. Otherwise, use isWelcomeScreen state and messages array
  let isWelcome = false;

  // Check if the current path contains a conversation ID
  const hasConversationId =
    pathname &&
    pathname.startsWith('/chat/') &&
    pathname !== '/chat/new' &&
    !pathname.includes('/chat/temp-'); // Temporary IDs are also considered valid conversation IDs

  // Check if the current path is an app detail page: /apps/{type}/[instanceId]
  const isAppDetailPage =
    pathname &&
    pathname.startsWith('/apps/') &&
    pathname.split('/').length === 4; // Format: /apps/{type}/[instanceId]

  if (pathname === '/chat/new') {
    // Always show welcome screen for /chat/new
    isWelcome = true;
  } else if (isAppDetailPage) {
    // Show welcome screen for app detail page when there are no messages
    isWelcome = messages.length === 0;
  } else if (hasConversationId) {
    // Never show welcome screen if there is a conversation ID in the path
    isWelcome = false;
  } else {
    // Otherwise, use isWelcomeScreen state and messages array
    isWelcome = isWelcomeScreen && messages.length === 0;
  }

  // Debug log for development
  console.log(
    `[useWelcomeScreen] pathname: ${pathname}, isWelcome: ${isWelcome}, messages: ${messages.length}, isAppDetailPage: ${isAppDetailPage}`
  );

  // Wrap setIsWelcomeScreen to ensure immediate response
  const setIsWelcomeScreen = useCallback(
    (value: boolean) => {
      setStoreWelcomeScreen(value);
    },
    [setStoreWelcomeScreen]
  );

  return {
    isWelcomeScreen: isWelcome,
    setIsWelcomeScreen,
  };
}
