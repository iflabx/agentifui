'use client';

import { historyConversationPath } from '@components/langchain/routing';
import { ConfirmDialog, SearchInput } from '@components/ui';
import { useAllConversations } from '@lib/hooks/use-all-conversations';
import { useChatInterface } from '@lib/hooks/use-chat-interface';
import { useChatWidth } from '@lib/hooks/use-chat-width';
import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useChatTransitionStore } from '@lib/stores/chat-transition-store';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';
import { Edit, Trash2 } from 'lucide-react';

import * as React from 'react';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { HistoryList } from './history-list';
import { HistorySelectionBar } from './history-selection-bar';

// History conversation page component
// Display all history conversations, support search function and multi-select delete function
export function History() {
  const t = useTranslations('history');
  const [searchQuery, setSearchQuery] = React.useState('');
  const router = useRouter();
  const { widthClass, paddingClass } = useChatWidth();

  // Multi-select function status management
  const [isSelectionMode, setIsSelectionMode] = React.useState(false);
  const [selectedConversations, setSelectedConversations] = React.useState<
    Set<string>
  >(new Set());
  const [showBatchDeleteDialog, setShowBatchDeleteDialog] =
    React.useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = React.useState(false);

  // Search box reference, used for automatic focus
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Get all history conversation lists, unlimited quantity
  const {
    conversations,
    isLoading,
    total,
    refresh,
    deleteConversation,
    renameConversation,
  } = useAllConversations();

  // Listen to global conversation data update events
  React.useEffect(() => {
    const unsubscribe = conversationEvents.subscribe(() => {
      refresh();
    });

    return () => {
      unsubscribe();
    };
  }, [refresh]);

  // Component mounting automatically focuses search box
  React.useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  // When the conversation list changes, clear invalid selected items
  React.useEffect(() => {
    if (selectedConversations.size > 0) {
      const validIds = new Set(
        conversations.map(c => c.id).filter(Boolean) as string[]
      );
      const validSelectedIds = new Set(
        Array.from(selectedConversations).filter(id => validIds.has(id))
      );

      if (validSelectedIds.size !== selectedConversations.size) {
        setSelectedConversations(validSelectedIds);
      }

      // If there are no valid selected items, exit selection mode
      if (validSelectedIds.size === 0) {
        setIsSelectionMode(false);
      }
    }
  }, [conversations, selectedConversations]);

  // Filter conversation list, based on search query
  const filteredConversations = React.useMemo(() => {
    if (!searchQuery.trim()) return conversations;

    const query = searchQuery.toLowerCase().trim();
    return conversations.filter(
      conversation =>
        conversation.title?.toLowerCase().includes(query) ||
        conversation.last_message_preview?.toLowerCase().includes(query)
    );
  }, [conversations, searchQuery]);

  // Multi-select function processing function
  const handleToggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode);
    if (isSelectionMode) {
      setSelectedConversations(new Set());
    }
  };

  const handleSelectConversation = (id: string, selected: boolean) => {
    const newSelected = new Set(selectedConversations);
    if (selected) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedConversations(newSelected);

    // If an item is selected but not in selection mode, automatically enter selection mode
    if (newSelected.size > 0 && !isSelectionMode) {
      setIsSelectionMode(true);
    }
  };

  const handleSelectAll = () => {
    const allIds = filteredConversations
      .map(c => c.id)
      .filter(Boolean) as string[];
    setSelectedConversations(new Set(allIds));
    setIsSelectionMode(true);
  };

  const handleDeselectAll = () => {
    setSelectedConversations(new Set());
  };

  const handleCancelSelection = () => {
    setSelectedConversations(new Set());
    setIsSelectionMode(false);
  };

  const handleBatchDelete = () => {
    if (selectedConversations.size === 0) return;
    setShowBatchDeleteDialog(true);
  };

  const handleBatchDeleteConfirm = async () => {
    setIsBatchDeleting(true);
    try {
      const deletePromises = Array.from(selectedConversations).map(id =>
        deleteConversation(id)
      );

      const results = await Promise.all(deletePromises);
      const successCount = results.filter(Boolean).length;

      if (successCount > 0) {
        // Refresh list
        refresh();
        // Trigger global synchronization event
        conversationEvents.emit();

        // Clear selection state
        setSelectedConversations(new Set());
        setIsSelectionMode(false);

        if (successCount < selectedConversations.size) {
          alert(
            t('operations.batchDeleteSuccess', {
              success: successCount,
              failed: selectedConversations.size - successCount,
            })
          );
        }
      } else {
        alert(t('operations.batchDeleteFailed'));
      }
    } catch (error) {
      console.error('Batch deletion failed:', error);
      alert(t('operations.operationError'));
    } finally {
      setIsBatchDeleting(false);
      setShowBatchDeleteDialog(false);
    }
  };

  // 🎯 New: new conversation processing function, unified management of state cleanup
  const { clearConversationState } = useChatInterface();

  const handleNewChat = () => {
    // Jump to new conversation page
    router.push('/chat/new');

    // Reset state
    setTimeout(() => {
      // Clear messages and reset state
      useChatStore.getState().clearMessages();
      useChatStore.getState().setCurrentConversationId(null);

      // 🎯 New: clear conversation state in use-chat-interface
      // This ensures that difyConversationId, dbConversationUUID, and conversationAppId are correctly cleared
      clearConversationState();

      // Clear other UI states
      useChatInputStore.getState().setIsWelcomeScreen(true);
      useChatTransitionStore.getState().setIsTransitioningToWelcome(true);
      useChatStore.getState().setIsWaitingForResponse(false);

      // Set sidebar selection state - keep current expanded state
      useSidebarStore.getState().selectItem('chat', null, true);

      // Set title
      // Title management is handled by DynamicTitle component, no need to set manually
    }, 100);
  };

  // Handle conversation item click
  const handleConversationClick = (id: string) => {
    // If in selection mode, do not jump, but switch selection state
    if (isSelectionMode) {
      const isSelected = selectedConversations.has(id);
      handleSelectConversation(id, !isSelected);
      return;
    }

    router.push(historyConversationPath(id, conversations));
  };

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col overflow-hidden',
        'bg-white dark:bg-stone-800'
      )}
    >
      {/* Fixed header area - does not scroll */}
      <div className="flex-shrink-0">
        {/* Title and new conversation button - centered display */}
        <div
          className={cn('mx-auto mb-6 w-full pt-4', widthClass, paddingClass)}
        >
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <h1
                className={cn(
                  'font-serif text-2xl font-bold',
                  'text-stone-800 dark:text-stone-100'
                )}
              >
                {t('title')}
              </h1>
              {/* Display conversation count with elegant styling */}

              <div
                className={cn(
                  'mt-1 text-sm',
                  'text-stone-600 dark:text-stone-400'
                )}
              >
                {total > 0 ? t('totalCount', { total }) : t('noRecords')}
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {/* Batch selection button */}
              {total > 0 && (
                <button
                  onClick={handleToggleSelectionMode}
                  className={cn(
                    'flex items-center rounded-lg px-3 py-2 font-serif text-sm font-medium',
                    'transition-all duration-200 ease-in-out',
                    'cursor-pointer hover:-translate-y-0.5 hover:shadow-md',
                    isSelectionMode
                      ? 'border border-stone-400 bg-stone-200 text-stone-800 shadow-md hover:bg-stone-300 dark:border-stone-500 dark:bg-stone-600 dark:text-white dark:hover:bg-stone-500'
                      : 'border border-stone-300 bg-stone-100 text-stone-700 hover:bg-stone-200 dark:border-stone-600 dark:bg-stone-700 dark:text-white dark:hover:bg-stone-600'
                  )}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {isSelectionMode ? t('exitSelection') : t('batchDelete')}
                </button>
              )}

              {/* New conversation button */}
              <button
                onClick={handleNewChat}
                className={cn(
                  'flex items-center rounded-lg px-3 py-2 font-serif text-sm font-medium',
                  'transition-all duration-200 ease-in-out',
                  'cursor-pointer hover:-translate-y-0.5 hover:shadow-md',
                  'border border-stone-300 bg-stone-100 text-stone-700 hover:bg-stone-200',
                  'dark:border-stone-600 dark:bg-stone-700 dark:text-white dark:hover:bg-stone-600'
                )}
              >
                <Edit className="mr-2 h-4 w-4" />
                {t('newChat')}
              </button>
            </div>
          </div>
        </div>

        {/* Search box - centered display */}
        <div className={cn('mx-auto mb-4 w-full', widthClass, paddingClass)}>
          <SearchInput
            ref={searchInputRef}
            value={searchQuery}
            onValueChange={setSearchQuery}
            placeholder={t('searchPlaceholder')}
            containerClassName="w-full"
            className={cn(
              'py-2', // History specific: py-2 instead of py-2.5
              'border-stone-300 bg-white text-stone-800 focus:ring-stone-400 focus:ring-offset-stone-50',
              'dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:focus:ring-stone-600 dark:focus:ring-offset-stone-900'
            )}
          />
        </div>

        {/* Selection operation bar - centered display */}
        <div className={cn('mx-auto w-full', widthClass, paddingClass)}>
          <HistorySelectionBar
            isSelectionMode={isSelectionMode}
            selectedCount={selectedConversations.size}
            totalCount={filteredConversations.length}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            onBatchDelete={handleBatchDelete}
            onCancelSelection={handleCancelSelection}
            isDeleting={isBatchDeleting}
          />
        </div>
      </div>

      {/* Scrollable list area - independent scrolling */}
      <div className="flex-1 overflow-hidden">
        {/* Conversation list container */}
        <div
          className={cn(
            'h-full overflow-y-auto',
            widthClass,
            'mx-auto',
            paddingClass
          )}
        >
          <HistoryList
            conversations={filteredConversations}
            isLoading={isLoading}
            onConversationClick={handleConversationClick}
            searchQuery={searchQuery}
            total={total}
            onDelete={deleteConversation}
            onRename={renameConversation}
            onRefresh={refresh}
            isSelectionMode={isSelectionMode}
            selectedConversations={selectedConversations}
            onSelectConversation={handleSelectConversation}
          />
        </div>
      </div>

      {/* Batch delete confirmation dialog */}
      <ConfirmDialog
        isOpen={showBatchDeleteDialog}
        onClose={() => setShowBatchDeleteDialog(false)}
        onConfirm={handleBatchDeleteConfirm}
        title={t('batchDeleteDialog.title')}
        message={t('batchDeleteDialog.message', {
          count: selectedConversations.size,
        })}
        confirmText={t('batchDeleteDialog.confirmText')}
        cancelText={t('batchDeleteDialog.cancelText')}
        variant="danger"
        isLoading={isBatchDeleting}
      />
    </div>
  );
}
