'use client';

import {
  type SidebarRecentItem,
  getDisplayConversations,
  getMoreActionsOpacityClass,
  getPendingChats,
  getSavedRecentItems,
  getUnpinnedChats,
  isPendingConversationLoading,
  isRecentTaskExecution,
} from '@components/sidebar/sidebar-chat-list/helpers';
import { SidebarRecentItemRow } from '@components/sidebar/sidebar-chat-list/recent-item';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { DropdownMenuV2 } from '@components/ui/dropdown-menu-v2';
import { InputDialog } from '@components/ui/input-dialog';
import { MoreButtonV2 } from '@components/ui/more-button-v2';
import {
  type CombinedConversation,
  conversationEvents,
  useCombinedConversations,
} from '@lib/hooks/use-combined-conversations';
import {
  type RecentTaskExecution,
  useRecentTaskExecutions,
} from '@lib/hooks/use-recent-task-executions';
import {
  deleteConversation,
  renameConversation,
} from '@lib/services/client/conversations-api';
import { usePendingConversationStore } from '@lib/stores/pending-conversation-store';
import { cn } from '@lib/utils';
import { FileText, MessageSquare, Pen, Trash, Workflow } from 'lucide-react';

import * as React from 'react';

import { useTranslations } from 'next-intl';

interface SidebarChatListProps {
  contentVisible: boolean;
  selectedId: string | null;
  onSelectChat: (chatId: string) => void;
  onSelectTaskExecution: (execution: RecentTaskExecution) => void;
}

function getRecentItemIcon(item: SidebarRecentItem) {
  if (!isRecentTaskExecution(item)) {
    return MessageSquare;
  }

  if (item.appType === 'workflow') {
    return Workflow;
  }

  return FileText;
}

export function SidebarChatList({
  contentVisible,
  selectedId,
  onSelectChat,
  onSelectTaskExecution,
}: SidebarChatListProps) {
  const t = useTranslations('sidebar');
  const {
    conversations,
    isLoading: isLoadingConversations,
    refresh,
  } = useCombinedConversations();
  const {
    executions: recentTaskExecutions,
    isLoading: isLoadingTaskExecutions,
  } = useRecentTaskExecutions();

  const completeTitleTypewriter = usePendingConversationStore(
    state => state.completeTitleTypewriter
  );

  const [showRenameDialog, setShowRenameDialog] = React.useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [isOperating, setIsOperating] = React.useState(false);
  const [selectedConversation, setSelectedConversation] =
    React.useState<CombinedConversation | null>(null);
  const [openDropdownId, setOpenDropdownId] = React.useState<string | null>(
    null
  );
  const [prevLoadedConversations, setPrevLoadedConversations] = React.useState<
    CombinedConversation[]
  >([]);

  React.useEffect(() => {
    if (!isLoadingConversations && conversations.length > 0) {
      setPrevLoadedConversations(conversations);
    }
  }, [isLoadingConversations, conversations]);

  React.useEffect(() => {
    const prevIds = new Set(prevLoadedConversations.map(conv => conv.id));
    const currentIds = new Set(conversations.map(conv => conv.id));
    const disappearedIds = Array.from(prevIds).filter(
      id => !currentIds.has(id)
    );

    if (disappearedIds.length > 0) {
      console.log(
        `[SidebarChatList] Detected ${disappearedIds.length} conversations pushed out:`,
        disappearedIds
      );
    }
  }, [conversations, prevLoadedConversations]);

  const displayConversations = React.useMemo(
    () =>
      getDisplayConversations(
        isLoadingConversations,
        conversations,
        prevLoadedConversations
      ),
    [isLoadingConversations, conversations, prevLoadedConversations]
  );

  const pendingChats = React.useMemo(
    () => getPendingChats(displayConversations),
    [displayConversations]
  );
  const visibleUnpinnedChats = React.useMemo(
    () => getUnpinnedChats(displayConversations),
    [displayConversations]
  );
  const savedRecentItems = React.useMemo(
    () => getSavedRecentItems(visibleUnpinnedChats, recentTaskExecutions),
    [recentTaskExecutions, visibleUnpinnedChats]
  );

  const handleRename = React.useCallback(
    async (chatId: string) => {
      const conversation = conversations.find(c => c.id === chatId);
      if (!conversation) {
        return;
      }

      setSelectedConversation(conversation);
      setShowRenameDialog(true);
    },
    [conversations]
  );

  const handleRenameConfirm = React.useCallback(
    async (newTitle: string) => {
      if (!selectedConversation) {
        return;
      }

      const dbPK = selectedConversation.db_pk;
      if (!dbPK) {
        alert(t('syncingMessage'));
        setShowRenameDialog(false);
        return;
      }

      setIsOperating(true);
      try {
        const result = await renameConversation(dbPK, newTitle.trim());

        if (result.success) {
          refresh();
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
    [refresh, selectedConversation, t]
  );

  const handleDelete = React.useCallback(
    async (chatId: string) => {
      const conversation = conversations.find(c => c.id === chatId);
      if (!conversation) {
        return;
      }

      setSelectedConversation(conversation);
      setShowDeleteDialog(true);
    },
    [conversations]
  );

  const handleDeleteConfirm = React.useCallback(async () => {
    if (!selectedConversation) {
      return;
    }

    const dbPK = selectedConversation.db_pk;
    if (!dbPK) {
      alert(t('syncingMessage'));
      setShowDeleteDialog(false);
      return;
    }

    setIsOperating(true);
    try {
      const result = await deleteConversation(dbPK);

      if (result.success) {
        refresh();
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
  }, [refresh, selectedConversation, selectedId, t]);

  const isRecentItemActive = React.useCallback(
    (chat: SidebarRecentItem) => {
      if (typeof window === 'undefined') {
        return false;
      }

      if (isRecentTaskExecution(chat)) {
        const currentUrl = new URL(window.location.href);
        const currentExecutionId = currentUrl.searchParams.get('executionId');
        const expectedPath = `/apps/${chat.appType}/${chat.appInstanceId}`;

        return (
          currentExecutionId === chat.id &&
          window.location.pathname === expectedPath
        );
      }

      if (!selectedId) {
        return false;
      }

      if (chat.id === selectedId) {
        return true;
      }
      if (chat.tempId && selectedId.includes(chat.tempId)) {
        return true;
      }

      const pathname = window.location.pathname;
      if (!pathname.startsWith('/chat/') || pathname === '/chat/history') {
        return false;
      }

      return false;
    },
    [selectedId]
  );

  React.useEffect(() => {
    if (!contentVisible) {
      pendingChats
        .filter(
          chat =>
            chat.titleTypewriterState?.shouldStartTyping &&
            chat.titleTypewriterState?.targetTitle
        )
        .forEach(chat => {
          completeTitleTypewriter(chat.id);
        });
    }
  }, [completeTitleTypewriter, contentVisible, pendingChats]);

  if (!contentVisible) {
    return null;
  }

  const createMoreActions = (
    chat: SidebarRecentItem,
    itemIsLoading: boolean
  ) => {
    if (isRecentTaskExecution(chat)) {
      return (
        <MoreButtonV2
          aria-label={t('moreOptions')}
          disabled={true}
          className="opacity-50"
        />
      );
    }

    const canPerformActions = !!chat.db_pk;
    const isTempChat = !chat.id || chat.id.startsWith('temp-');
    const isMenuOpen = openDropdownId === chat.id;

    return (
      <DropdownMenuV2
        placement="bottom"
        minWidth={120}
        isOpen={isMenuOpen}
        onOpenChange={isOpen => setOpenDropdownId(isOpen ? chat.id : null)}
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

  const hasAnyConversations =
    pendingChats.length > 0 || savedRecentItems.length > 0;

  if (
    !isLoadingConversations &&
    !isLoadingTaskExecutions &&
    !hasAnyConversations
  ) {
    return null;
  }

  return (
    <>
      <div className="flex flex-col space-y-1">
        {hasAnyConversations && (
          <div
            className={cn(
              'sticky top-0 z-40 ml-[6px] flex items-center px-2 py-1 font-serif text-xs font-medium',
              'bg-stone-200 dark:bg-stone-700'
            )}
          >
            <span
              className={cn(
                'font-serif text-xs leading-none font-medium',
                'text-stone-500 dark:text-stone-400'
              )}
            >
              {t('recentRecords')}
            </span>
          </div>
        )}

        {pendingChats.length > 0 && (
          <div className="mb-0.5 pt-1">
            <div className="space-y-0.5 px-3">
              {pendingChats.map(chat => {
                const itemIsLoading = isPendingConversationLoading(chat);

                return (
                  <SidebarRecentItemRow
                    key={chat.tempId || chat.id}
                    chat={chat}
                    active={isRecentItemActive(chat)}
                    icon={getRecentItemIcon(chat)}
                    isLoading={itemIsLoading}
                    hasOpenDropdown={openDropdownId === chat.id}
                    disableHover={!!openDropdownId}
                    untitledLabel={t('untitled')}
                    onClick={() => onSelectChat(chat.id)}
                    onTypewriterComplete={completeTitleTypewriter}
                    moreActionsTrigger={
                      <div
                        className={cn(
                          'transition-opacity',
                          getMoreActionsOpacityClass(
                            openDropdownId,
                            chat.id,
                            itemIsLoading
                          )
                        )}
                      >
                        {createMoreActions(chat, itemIsLoading)}
                      </div>
                    }
                  />
                );
              })}
            </div>
          </div>
        )}

        <div className="pt-0.5">
          <div className="space-y-0.5 px-3">
            {savedRecentItems.map(chat => {
              const itemIsLoading = false;
              const handleClick = () => {
                if (isRecentTaskExecution(chat)) {
                  onSelectTaskExecution(chat);
                  return;
                }

                onSelectChat(chat.id);
              };

              return (
                <SidebarRecentItemRow
                  key={
                    isRecentTaskExecution(chat)
                      ? `execution-${chat.id}`
                      : chat.id
                  }
                  chat={chat}
                  active={isRecentItemActive(chat)}
                  icon={getRecentItemIcon(chat)}
                  isLoading={itemIsLoading}
                  hasOpenDropdown={openDropdownId === chat.id}
                  disableHover={!!openDropdownId}
                  untitledLabel={t('untitled')}
                  onClick={handleClick}
                  onTypewriterComplete={completeTitleTypewriter}
                  moreActionsTrigger={
                    <div
                      className={cn(
                        'transition-opacity',
                        getMoreActionsOpacityClass(
                          openDropdownId,
                          chat.id,
                          itemIsLoading
                        )
                      )}
                    >
                      {createMoreActions(chat, itemIsLoading)}
                    </div>
                  }
                />
              );
            })}
          </div>
        </div>
      </div>

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
