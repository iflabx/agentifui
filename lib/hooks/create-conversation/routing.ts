'use client';

import { useChatStore } from '@lib/stores/chat-store';
import { useSidebarStore } from '@lib/stores/sidebar-store';

export function applyTemporaryConversationUi(
  tempConvId: string,
  setCurrentChatConversationId: (conversationId: string | null) => void
): void {
  try {
    const currentPath = window.location.pathname;
    if (
      currentPath === '/chat/new' ||
      !currentPath.startsWith('/chat/temp-') ||
      currentPath.startsWith('/apps/')
    ) {
      console.log(
        `[useCreateConversation] Early highlight: Updating URL to /chat/${tempConvId}`
      );
      window.history.replaceState({}, '', `/chat/${tempConvId}`);
    }

    console.log(
      `[useCreateConversation] Early highlight: Setting ChatStore currentConversationId to ${tempConvId}`
    );
    setCurrentChatConversationId(tempConvId);

    const { selectItem } = useSidebarStore.getState();
    console.log(
      `[useCreateConversation] Early highlight: Selecting item in SidebarStore: ${tempConvId}`
    );
    selectItem('chat', tempConvId, true);
  } catch (highlightError) {
    console.error(
      '[useCreateConversation] Error during early highlight:',
      highlightError
    );
  }
}

export function syncRealConversationUi(
  tempConvId: string,
  realConvId: string
): void {
  const currentPath = window.location.pathname;
  if (currentPath === `/chat/${tempConvId}`) {
    console.log(
      `[useCreateConversation] Updating URL from ${currentPath} to /chat/${realConvId}`
    );
    window.history.replaceState({}, '', `/chat/${realConvId}`);
  } else if (
    currentPath.includes('/chat/temp-') ||
    currentPath === '/chat/new' ||
    currentPath.startsWith('/apps/')
  ) {
    console.log(
      `[useCreateConversation] Updating URL (from new/temp/apps) to /chat/${realConvId}`
    );
    window.history.replaceState({}, '', `/chat/${realConvId}`);
  }

  try {
    const chatStoreState = useChatStore.getState();
    if (
      chatStoreState.currentConversationId === tempConvId ||
      chatStoreState.currentConversationId === null
    ) {
      chatStoreState.setCurrentConversationId(realConvId);
    }

    const sidebarStoreState = useSidebarStore.getState();
    if (
      sidebarStoreState.selectedId === tempConvId ||
      sidebarStoreState.selectedId === null
    ) {
      sidebarStoreState.selectItem('chat', realConvId, true);
    }
  } catch (error) {
    console.error(
      '[useCreateConversation] Error updating stores to realId:',
      error
    );
  }
}

export function syncFallbackConversationPath(
  tempConvId: string,
  realConvId: string
): void {
  const currentPath = window.location.pathname;
  if (
    currentPath === `/chat/${tempConvId}` ||
    currentPath.includes('/chat/temp-') ||
    currentPath === '/chat/new' ||
    currentPath.startsWith('/apps/')
  ) {
    console.log(
      `[useCreateConversation] Updating URL (fallback) from ${currentPath} to /chat/${realConvId}`
    );
    window.history.replaceState({}, '', `/chat/${realConvId}`);
  }
}

export function selectConversationIfCurrent(
  conversationId: string,
  logContext: string
): void {
  try {
    const currentPath = window.location.pathname;
    if (currentPath === `/chat/${conversationId}`) {
      const { selectItem } = useSidebarStore.getState();
      selectItem('chat', conversationId, true);
    }
  } catch (error) {
    console.error(`[useCreateConversation] ${logContext}:`, error);
  }
}
