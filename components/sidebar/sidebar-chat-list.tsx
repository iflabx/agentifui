'use client';

import { ConfirmDialog, InputDialog } from '@components/ui';
import { DropdownMenuV2 } from '@components/ui/dropdown-menu-v2';
import { MoreButtonV2 } from '@components/ui/more-button-v2';
import { TypeWriter } from '@components/ui/typewriter';
import {
  CombinedConversation,
  conversationEvents,
  useCombinedConversations,
} from '@lib/hooks/use-combined-conversations';
import { usePendingConversationStore } from '@lib/stores/pending-conversation-store';
import { cn } from '@lib/utils';
import { Pen, Trash } from 'lucide-react';

import * as React from 'react';

import { useTranslations } from 'next-intl';

// Use new SidebarListButton component
import { SidebarListButton } from './sidebar-list-button';

interface SidebarChatListProps {
  contentVisible: boolean;
  selectedId: string | null;
  onSelectChat: (chatId: string) => void;
}

export function SidebarChatList({
  contentVisible,
  selectedId,
  onSelectChat,
}: SidebarChatListProps) {
  const t = useTranslations('sidebar');
  const {
    conversations,
    isLoading: isLoadingConversations,
    refresh,
  } = useCombinedConversations();

  const completeTitleTypewriter = usePendingConversationStore(
    state => state.completeTitleTypewriter
  );

  // Dialog state management
  const [showRenameDialog, setShowRenameDialog] = React.useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [isOperating, setIsOperating] = React.useState(false);
  const [selectedConversation, setSelectedConversation] =
    React.useState<CombinedConversation | null>(null);

  // 🎯 New: Dropdown menu state management
  // Record the conversation ID corresponding to the currently opened dropdown menu
  const [openDropdownId, setOpenDropdownId] = React.useState<string | null>(
    null
  );

  const [prevLoadedConversations, setPrevLoadedConversations] = React.useState<
    CombinedConversation[]
  >([]);

  // When the conversation list is successfully loaded, save the current state
  React.useEffect(() => {
    if (!isLoadingConversations && conversations.length > 0) {
      setPrevLoadedConversations(conversations);
    }
  }, [isLoadingConversations, conversations]);

  // 🎯 Detect conversation list changes, identify conversations that have been pushed out (instant disappearance effect)
  React.useEffect(() => {
    const prevIds = new Set(prevLoadedConversations.map(conv => conv.id));
    const currentIds = new Set(conversations.map(conv => conv.id));

    // Find conversation IDs that exist in the previous list but do not exist in the current list
    const disappearedIds = Array.from(prevIds).filter(
      id => !currentIds.has(id)
    );

    if (disappearedIds.length > 0) {
      console.log(
        `[SidebarChatList] 🎯 Detected ${disappearedIds.length} conversations pushed out:`,
        disappearedIds
      );
      // Instant disappearance effect: conversations disappear directly from the list
    }
  }, [conversations, prevLoadedConversations]);

  // 🎯 Display logic: display the current conversation list directly (instant disappearance effect)
  const displayConversations = React.useMemo(() => {
    return isLoadingConversations &&
      conversations.length === 0 &&
      prevLoadedConversations.length > 0
      ? prevLoadedConversations
      : conversations;
  }, [isLoadingConversations, conversations, prevLoadedConversations]);

  const unpinnedChats = React.useMemo(() => {
    return displayConversations.filter(chat => !chat.isPending);
  }, [displayConversations]);

  const pendingChats = React.useMemo(() => {
    return displayConversations.filter(chat => chat.isPending === true);
  }, [displayConversations]);

  // Use historical conversations in the database, which is already limited to 20 by default
  // The conversation list obtained using useSidebarConversations is already limited to 20
  const visibleUnpinnedChats = unpinnedChats;

  const handleRename = React.useCallback(
    async (chatId: string) => {
      const conversation = conversations.find(c => c.id === chatId);
      if (!conversation) return;

      setSelectedConversation(conversation);
      setShowRenameDialog(true);
    },
    [conversations]
  );

  const handleRenameConfirm = React.useCallback(
    async (newTitle: string) => {
      if (!selectedConversation) return;

      const dbPK = selectedConversation.db_pk;
      if (!dbPK) {
        alert(t('syncingMessage'));
        setShowRenameDialog(false);
        return;
      }

      setIsOperating(true);
      try {
        const { renameConversation } = await import('@lib/db/conversations');
        const result = await renameConversation(dbPK, newTitle.trim());

        if (result.success) {
          // After renaming successfully, update the page title directly, no need to refresh the page
          if (selectedId === selectedConversation.id) {
            // Title management is handled by the DynamicTitle component uniformly, no need to set manually
          }

          refresh();
          // Trigger global synchronization event, notify all components that data has been updated
          conversationEvents.emit();
          setShowRenameDialog(false);
        } else {
          console.error('Rename conversation failed:', result.error);
          alert(t('operationFailed'));
        }
      } catch (error) {
        console.error('Rename conversation operation failed:', error);
        alert(t('operationFailed'));
      } finally {
        setIsOperating(false);
      }
    },
    [selectedConversation, selectedId, refresh, t]
  );

  const handleDelete = React.useCallback(
    async (chatId: string) => {
      const conversation = conversations.find(c => c.id === chatId);
      if (!conversation) return;

      setSelectedConversation(conversation);
      setShowDeleteDialog(true);
    },
    [conversations]
  );

  const handleDeleteConfirm = React.useCallback(async () => {
    if (!selectedConversation) return;

    const dbPK = selectedConversation.db_pk;
    if (!dbPK) {
      alert(t('syncingMessage'));
      setShowDeleteDialog(false);
      return;
    }

    setIsOperating(true);
    try {
      const { deleteConversation } = await import('@lib/db/conversations');
      const result = await deleteConversation(dbPK);

      if (result.success) {
        refresh();
        // After deleting the conversation, directly route to /chat/new
        // Trigger global synchronization event, notify all components that data has been updated
        conversationEvents.emit();
        if (selectedId === selectedConversation.id) {
          window.location.href = '/chat/new';
        }
        setShowDeleteDialog(false);
      } else {
        console.error('Delete conversation failed:', result.error);
        alert(t('operationFailed'));
      }
    } catch (error) {
      console.error('Delete conversation operation failed:', error);
      alert(t('operationFailed'));
    } finally {
      setIsOperating(false);
    }
  }, [selectedConversation, selectedId, refresh, t]);

  // Add auxiliary function, determine whether the chat item should be selected
  // Consider the conversion between temporary ID and official ID
  // Determine whether the chat item is selected
  // 1. Check if the current route is a chat page
  // 2. Check if the ID matches (direct ID or temporary ID)
  // This ensures that when switching from the chat page to other pages, the chat item will not remain selected
  const isChatActive = React.useCallback(
    (chat: CombinedConversation) => {
      // First check if there is a selected ID
      if (!selectedId) return false;

      // PRIORITY 1: Direct selectedId matching - immediate response for clicked conversations
      // This ensures instant highlight when user clicks, regardless of pathname update status
      if (chat.id === selectedId) return true;
      if (chat.tempId && selectedId.includes(chat.tempId)) return true;

      // PRIORITY 2: Fallback pathname-based check for edge cases
      // Only apply when selectedId doesn't match this chat
      const pathname = window.location.pathname;

      // Skip pathname check if we're not on a chat page or on history page
      if (!pathname.startsWith('/chat/') || pathname === '/chat/history') {
        return false;
      }

      // If selectedId doesn't match this chat, it's definitely not active
      return false;
    },
    [selectedId]
  );

  // 🎯 Handle the typewriter effect when the sidebar is not visible
  // If the sidebar content is not visible, but there are pending typewriter effects, complete them directly
  React.useEffect(() => {
    if (!contentVisible) {
      // Find all conversations that need typewriter effect
      const chatsNeedingTypewriter = pendingChats.filter(
        chat =>
          chat.titleTypewriterState?.shouldStartTyping &&
          chat.titleTypewriterState?.targetTitle
      );

      // Complete all typewriter effects directly
      chatsNeedingTypewriter.forEach(chat => {
        completeTitleTypewriter(chat.id);
      });
    }
  }, [contentVisible, pendingChats, completeTitleTypewriter]);

  if (!contentVisible) return null;

  // 🎯 Modify the rendering logic, integrate TypeWriter component to implement typewriter effect
  // Use a unified structure and height to avoid layout jumps when switching
  // Considering the space occupied by the more button on the right, ensure the skeleton screen width is appropriate
  const renderChatItemContent = (
    chat: CombinedConversation,
    isItemLoading: boolean
  ) => {
    const title = chat.title || t('untitled');

    // 🎯 Check if typewriter effect is needed
    const shouldUseTypewriter =
      chat.isPending &&
      chat.titleTypewriterState?.shouldStartTyping &&
      chat.titleTypewriterState?.targetTitle;

    // Use the same height and structure in all states to ensure consistency
    return (
      <div className="flex h-4 w-full items-center">
        {' '}
        {/* Increase height to h-4 to prevent the letter drop from being cut */}
        {isItemLoading ? (
          // Skeleton screen - set width to w-[85%] to reserve space for the more button on the right
          <div
            className={cn(
              'h-4 w-[85%] animate-pulse rounded-md',
              'bg-stone-400 dark:bg-stone-600',
              'opacity-80'
            )}
          />
        ) : shouldUseTypewriter ? (
          // 🎯 Use TypeWriter component to display typewriter effect, wrap in h4 tag to apply decorative font
          <h4
            className={cn(
              'w-full truncate font-serif text-xs leading-4 font-medium',
              'text-stone-700 dark:text-gray-200'
            )}
          >
            <TypeWriter
              text={chat.titleTypewriterState!.targetTitle}
              speed={30} // Faster typewriter speed
              delay={200} // Short delay
              className="font-serif text-xs leading-4 font-medium"
              onComplete={() => {
                // 🎯 After typing is complete, update the store state
                completeTitleTypewriter(chat.id);
              }}
            />
          </h4>
        ) : (
          // Title text - use h4 tag to apply decorative font, consistent with history conversation page
          <h4
            className={cn(
              'w-full truncate font-serif text-xs leading-4 font-medium',
              'text-stone-700 dark:text-gray-200'
            )}
          >
            {title}
          </h4>
        )}
      </div>
    );
  };

  // Modify createMoreActions function, ensure layout consistency when switching between temporary ID and official ID
  // For conversations with temporary ID, return a disabled more button instead of null, maintain layout consistency
  // Optimize dropdown menu style, make it more consistent with the overall theme
  // 🎯 New: Integrate dropdown menu state management, implement structural effect
  const createMoreActions = (
    chat: CombinedConversation,
    itemIsLoading: boolean
  ) => {
    const canPerformActions = !!chat.db_pk;
    const isTempChat = !chat.id || chat.id.startsWith('temp-');
    const isMenuOpen = openDropdownId === chat.id;

    // 🎯 Handle dropdown menu state changes
    const handleMenuOpenChange = (isOpen: boolean) => {
      setOpenDropdownId(isOpen ? chat.id : null);
    };

    return (
      <DropdownMenuV2
        placement="bottom"
        minWidth={120}
        isOpen={isMenuOpen}
        onOpenChange={handleMenuOpenChange}
        trigger={
          <MoreButtonV2
            aria-label={t('moreOptions')}
            disabled={itemIsLoading || !canPerformActions || isTempChat}
            isMenuOpen={isMenuOpen}
            disableHover={!!openDropdownId && !isMenuOpen}
            className={cn(
              'transition-opacity',
              itemIsLoading || !canPerformActions || isTempChat
                ? 'opacity-50'
                : ''
            )}
          />
        }
      >
        <DropdownMenuV2.Item
          icon={<Pen className="h-3.5 w-3.5" />}
          onClick={() => handleRename(chat.id)}
          disabled={itemIsLoading || !canPerformActions || isTempChat}
        >
          {t('rename')}
        </DropdownMenuV2.Item>
        <DropdownMenuV2.Item
          icon={<Trash className="h-3.5 w-3.5" />}
          danger
          onClick={() => handleDelete(chat.id)}
          disabled={itemIsLoading || !canPerformActions || isTempChat}
        >
          {t('delete')}
        </DropdownMenuV2.Item>
      </DropdownMenuV2>
    );
  };

  // 🎯 Fix: completely hide when there are no conversations, consistent with common applications
  const hasAnyConversations =
    pendingChats.length > 0 || visibleUnpinnedChats.length > 0;

  if (!isLoadingConversations && !hasAnyConversations) {
    return null;
  }

  return (
    <>
      <div className="flex flex-col space-y-1">
        {/* Recent chats sticky header: mimic favorite apps style, add sticky positioning */}
        {/* Fix: only show title when there are conversations to avoid appearing then disappearing */}

        {hasAnyConversations && (
          <div
            className={cn(
              'sticky top-0 z-40 ml-[6px] flex items-center px-2 py-1 font-serif text-xs font-medium',
              // Use the same background color as the sidebar, ensure the sticky effect is perfect
              // Ensure z-index is high enough to completely cover the content below
              'bg-stone-200 dark:bg-stone-700'
            )}
          >
            <span
              className={cn(
                'font-serif text-xs leading-none font-medium',
                'text-stone-500 dark:text-stone-400'
              )}
            >
              {t('recentChats')}
            </span>
          </div>
        )}

        {/* --- Pending conversation list --- */}
        {pendingChats.length > 0 && (
          <div className="mb-0.5 pt-1">
            {' '}
            {/* 🟢 Fix: mb-1.5 changed to mb-0.5, consistent with internal spacing */}
            <div className="space-y-0.5 px-3">
              {' '}
              {/* Decrease the spacing between list items */}
              {pendingChats.map(chat => {
                const itemIsLoading =
                  chat.pendingStatus === 'creating' ||
                  chat.pendingStatus === 'title_fetching' ||
                  chat.pendingStatus === 'streaming_message';
                // Use auxiliary function to determine whether the item should be selected
                // Handle the conversion between temporary ID and official ID
                const isActive = isChatActive(chat);

                return (
                  <div className="group relative" key={chat.tempId || chat.id}>
                    {/* Use new SidebarListButton instead of SidebarButton */}
                    <SidebarListButton
                      active={isActive}
                      onClick={() => onSelectChat(chat.id)}
                      isLoading={itemIsLoading}
                      hasOpenDropdown={openDropdownId === chat.id}
                      disableHover={!!openDropdownId}
                      moreActionsTrigger={
                        <div
                          className={cn(
                            'transition-opacity',
                            // 🎯 When a menu is open, disable group-hover effect to avoid showing the more button of other items when hovering
                            // But the more button of the item with the open menu should be displayed
                            itemIsLoading
                              ? 'pointer-events-none' // Disable interaction but keep the placeholder
                              : openDropdownId === chat.id
                                ? 'opacity-100' // The item with the open menu, the more button should be displayed
                                : openDropdownId
                                  ? 'opacity-0' // When there are other menus open, the more button of this item is not displayed
                                  : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100' // Hover display under normal state
                          )}
                        >
                          {/* Display more button regardless of loading, ensure layout consistency */}
                          {createMoreActions(chat, itemIsLoading)}
                        </div>
                      }
                    >
                      {renderChatItemContent(chat, itemIsLoading)}
                    </SidebarListButton>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* --- Saved conversation list --- */}
        <div className="pt-0.5">
          {' '}
          {/* 🟢 Fix: pt-1 changed to pt-0.5, consistent with internal spacing */}
          <div className="space-y-0.5 px-3">
            {' '}
            {/* Decrease the spacing between list items */}
            {visibleUnpinnedChats.map(chat => {
              // Use auxiliary function to determine whether the item should be selected
              // Handle the selection logic of saved conversations, ensure precise matching
              const isActive = isChatActive(chat);
              const itemIsLoading = false;

              return (
                <div className="group relative" key={chat.id}>
                  {/* Use new SidebarListButton instead of SidebarButton */}
                  <SidebarListButton
                    active={isActive}
                    onClick={() => onSelectChat(chat.id)}
                    isLoading={false}
                    hasOpenDropdown={openDropdownId === chat.id}
                    disableHover={!!openDropdownId}
                    moreActionsTrigger={
                      <div
                        className={cn(
                          'transition-opacity',
                          // 🎯 When a menu is open, disable group-hover effect to avoid showing the more button of other items when hovering
                          // But the more button of the item with the open menu should be displayed
                          openDropdownId === chat.id
                            ? 'opacity-100' // The item with the open menu, the more button should be displayed
                            : openDropdownId
                              ? 'opacity-0' // When there are other menus open, the more button of this item is not displayed
                              : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100' // Hover display under normal state
                        )}
                      >
                        {createMoreActions(chat, itemIsLoading)}
                      </div>
                    }
                  >
                    {renderChatItemContent(chat, itemIsLoading)}
                  </SidebarListButton>
                </div>
              );
            })}
            {/* Remove view all history button, moved to Header area */}
          </div>
        </div>
      </div>

      {/* Rename dialog */}
      <InputDialog
        isOpen={showRenameDialog}
        onClose={() => !isOperating && setShowRenameDialog(false)}
        onConfirm={handleRenameConfirm}
        title={t('renameDialog.title')}
        label={t('renameDialog.label')}
        placeholder={t('renameDialog.placeholder')}
        defaultValue={selectedConversation?.title || t('untitled')}
        confirmText={t('renameDialog.confirmText')}
        isLoading={isOperating}
        maxLength={50}
      />

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => !isOperating && setShowDeleteDialog(false)}
        onConfirm={handleDeleteConfirm}
        title={t('deleteDialog.title')}
        message={t('deleteDialog.message', {
          title: selectedConversation?.title || t('untitled'),
        })}
        confirmText={t('deleteDialog.confirmText')}
        variant="danger"
        icon="delete"
        isLoading={isOperating}
      />
    </>
  );
}
