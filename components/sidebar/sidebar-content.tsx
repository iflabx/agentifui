'use client';

import { useMobile } from '@lib/hooks/use-mobile';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';

import * as React from 'react';

import { useRouter } from 'next/navigation';

import { SidebarChatList } from './sidebar-chat-list';
import { SidebarFavoriteApps } from './sidebar-favorite-apps';

/**
 * Sidebar content component
 *
 * Manage the main content area of the sidebar, including favorite apps and chat list
 * Provide selected state management and pass the state to the child components
 */
export function SidebarContent() {
  const {
    isExpanded,
    selectedType,
    selectedId,
    selectItem,
    contentVisible,
    updateContentVisibility,
    showContent,
  } = useSidebarStore();
  const isMobile = useMobile();
  const router = useRouter();

  // Get chat-related status and methods
  const setCurrentConversationId = useChatStore(
    state => state.setCurrentConversationId
  );
  const { setIsWelcomeScreen } = useChatInputStore();

  // Handle the content display logic for the sidebar expansion/collapse
  React.useEffect(() => {
    // First notify the store to update the basic state of content visibility
    updateContentVisibility(isMobile);

    // Only add delay display for desktop
    if (isExpanded && !isMobile) {
      const timer = setTimeout(() => {
        showContent();
      }, 20); // Desktop retains delay animation
      return () => clearTimeout(timer);
    }
    // 🎯 Remove the dependency on the store method to avoid re-execution and flickering when switching routes
    // Zustand store method may change the reference when switching routes, causing unnecessary re-rendering
  }, [isExpanded, isMobile]);

  /**
   * Callback function for selecting a chat item
   * @param chatId ID of the chat item
   */
  const handleSelectChat = React.useCallback(
    (chatId: number | string) => {
      try {
        selectItem('chat', chatId, true);
        router.push(`/chat/${chatId}`);
        setCurrentConversationId(String(chatId));
        setIsWelcomeScreen(false);
      } catch (error) {
        console.error('[ChatList] Failed to switch conversation:', error);
      }
    },
    [selectItem, router, setCurrentConversationId, setIsWelcomeScreen]
  );

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Removed top divider: no horizontal line separation in dark mode */}

      {/* Scrollable Content Area */}
      <div
        className={cn(
          'absolute inset-0 flex flex-col overflow-y-auto pb-4',
          'scrollbar-thin scrollbar-track-transparent',
          'scrollbar-thumb-accent dark:scrollbar-thumb-gray-600',
          // On mobile, do not apply animation effect, display directly
          !isMobile &&
            isExpanded &&
            'transition-[opacity,transform] duration-150 ease-in-out',
          // Control visibility and animation state
          isExpanded
            ? contentVisible
              ? // On mobile, do not apply animation effect, display directly
                'transform-none opacity-100'
              : // Desktop retains animation effect
                !isMobile
                ? 'pointer-events-none -translate-x-4 scale-95 opacity-0'
                : 'transform-none opacity-100'
            : 'hidden' // Collapsed, hide directly
        )}
      >
        {/* Favorite apps area: directly placed without extra wrapping, supports sticky scrolling */}
        <SidebarFavoriteApps contentVisible={contentVisible} />

        {/* Chat list area: adds top spacing, separated from favorite apps */}
        <div className="mt-4 min-h-0 flex-1">
          <SidebarChatList
            contentVisible={contentVisible}
            selectedId={selectedType === 'chat' ? String(selectedId) : null}
            onSelectChat={handleSelectChat}
          />
        </div>
      </div>

      {/* Removed bottom divider: no horizontal line separation in dark mode */}
    </div>
  );
}
