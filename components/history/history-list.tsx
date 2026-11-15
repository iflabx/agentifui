'use client';

import { ConfirmDialog, InputDialog } from '@components/ui';
import { DropdownMenu } from '@components/ui/dropdown-menu';
import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import {
  DateFormatPresets,
  useDateFormatter,
} from '@lib/hooks/use-date-formatter';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useDropdownStore } from '@lib/stores/ui/dropdown-store';
import { Conversation } from '@lib/types/database';
import { cn } from '@lib/utils';
import {
  Archive,
  Clock,
  MoreHorizontal,
  Pen,
  Search,
  Trash,
} from 'lucide-react';

import * as React from 'react';

import { useTranslations } from 'next-intl';

/**
 * History list component properties
 * @description Defines the props interface for the history list component
 */
interface HistoryListProps {
  /** List of conversations to display */
  conversations: Conversation[];
  /** Whether the list is currently loading */
  isLoading: boolean;
  /** Callback when a conversation is clicked */
  onConversationClick: (id: string) => void;
  /** Current search query */
  searchQuery: string;
  /** Total number of conversations */
  total: number;
  /** Callback to delete a conversation */
  onDelete: (conversationId: string) => Promise<boolean>;
  /** Callback to rename a conversation */
  onRename: (conversationId: string, newTitle: string) => Promise<boolean>;
  /** Callback to refresh the conversation list */
  onRefresh: () => void;
  /** Whether selection mode is enabled */
  isSelectionMode?: boolean;
  /** Set of selected conversation IDs */
  selectedConversations?: Set<string>;
  /** Callback when a conversation is selected/deselected */
  onSelectConversation?: (id: string, selected: boolean) => void;
}

/**
 * History list component
 * @description Displays conversation list with search, delete, rename and multi-selection functionality
 *
 * @features
 * - Conversation list display
 * - Search functionality
 * - Delete and rename operations
 * - Multi-selection support
 * - Loading and empty states
 */
export function HistoryList({
  conversations,
  onConversationClick,
  searchQuery,
  total,
  onDelete,
  onRename,
  onRefresh,
  isSelectionMode = false,
  selectedConversations = new Set(),
  onSelectConversation,
}: HistoryListProps): React.ReactElement {
  const actorEpoch = React.useRef(
    useChatInputStore.getState().actorEpoch
  ).current;
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrentActor = () =>
    mounted.current && useChatInputStore.getState().actorEpoch === actorEpoch;
  const t = useTranslations('history');
  const { formatDate } = useDateFormatter();

  // Dialog state management
  const [showRenameDialog, setShowRenameDialog] = React.useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [isOperating, setIsOperating] = React.useState(false);
  const [selectedConversation, setSelectedConversation] =
    React.useState<Conversation | null>(null);

  // Handle conversation rename
  const handleRename = async (conversation: Conversation) => {
    if (!conversation.id) return;

    setSelectedConversation(conversation);
    setShowRenameDialog(true);
  };

  const handleRenameConfirm = async (newTitle: string) => {
    if (!isCurrentActor() || !selectedConversation?.id) return;

    setIsOperating(true);
    try {
      const success = await onRename(selectedConversation.id, newTitle.trim());
      if (!isCurrentActor()) return;

      if (success) {
        // Refresh list to display new title
        // Title management is handled by DynamicTitle component, no manual setting needed
        onRefresh();

        // Trigger global sync event to notify all components of data update
        conversationEvents.emit();
        setShowRenameDialog(false);
      } else {
        alert(t('operations.renameFailed'));
      }
    } catch {
      if (!isCurrentActor()) return;
      alert(t('operations.error'));
    } finally {
      if (isCurrentActor()) setIsOperating(false);
    }
  };

  // Handle conversation deletion
  const handleDelete = async (conversation: Conversation) => {
    if (!conversation.id) return;

    setSelectedConversation(conversation);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    if (!isCurrentActor() || !selectedConversation?.id) return;

    setIsOperating(true);
    try {
      const success = await onDelete(selectedConversation.id);
      if (!isCurrentActor()) return;

      if (success) {
        // Refresh list to update display
        onRefresh();

        // Trigger global sync event to notify all components of data update
        conversationEvents.emit();
        setShowDeleteDialog(false);
      } else {
        alert(t('operations.deleteFailed'));
      }
    } catch {
      if (!isCurrentActor()) return;
      alert(t('operations.error'));
    } finally {
      if (isCurrentActor()) setIsOperating(false);
    }
  };

  // Handle conversation item click with title setting logic
  const handleConversationItemClick = (conversation: Conversation) => {
    const conversationId = conversation.external_id || conversation.id || '';

    // Call parent component's click handler
    onConversationClick(conversationId);
  };

  // Render individual conversation item
  const renderConversationItem = (conversation: Conversation) => {
    const title = conversation.title || t('newChat');
    const preview = conversation.last_message_preview || t('noMessagePreview');
    const date = conversation.updated_at
      ? formatDate(conversation.updated_at, DateFormatPresets.dateTime)
      : '';
    const conversationId = conversation.id;
    const isSelected = conversationId
      ? selectedConversations.has(conversationId)
      : false;

    // Handle checkbox click event
    const handleCheckboxClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (conversationId && onSelectConversation) {
        onSelectConversation(conversationId, !isSelected);
      }
    };

    // Handle item click event - toggle selection in selection mode, otherwise navigate normally
    const handleItemClick = () => {
      if (isSelectionMode && conversationId && onSelectConversation) {
        onSelectConversation(conversationId, !isSelected);
      } else {
        handleConversationItemClick(conversation);
      }
    };

    return (
      <div
        key={conversation.id}
        className={cn(
          'group relative flex cursor-pointer items-start rounded-lg p-4',
          'transition-all duration-200 ease-in-out',
          // In selection mode, selected items have different styling
          isSelectionMode &&
            isSelected &&
            'border-stone-400 bg-stone-100 dark:border-stone-500 dark:bg-stone-700/40',
          // Normal hover styling
          !isSelected &&
            'border border-stone-300 hover:border-stone-400 hover:bg-stone-200/70 dark:border-stone-600 dark:hover:border-stone-500 dark:hover:bg-stone-700/50',
          // Selected state border
          isSelected && 'border border-stone-400 dark:border-stone-500',
          !isSelected && 'border border-stone-300 dark:border-stone-600',
          'mb-3'
        )}
        onClick={handleItemClick}
      >
        {/* Left selection area */}
        {(isSelectionMode || isSelected) && (
          <div className="mt-1 mr-3 flex items-center">
            <button
              onClick={handleCheckboxClick}
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded border-2',
                'transition-all duration-200 ease-in-out',
                'hover:scale-110',
                isSelected
                  ? 'border-stone-500 bg-stone-500 text-white dark:border-stone-600 dark:bg-stone-600'
                  : 'border-stone-400 hover:border-stone-500 dark:border-stone-600 dark:hover:border-stone-500'
              )}
            >
              {isSelected && (
                <svg
                  className="h-3 w-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
          </div>
        )}

        {/* Right content area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Title and date */}
          <div className="mb-2 flex items-center justify-between">
            <h3
              className={cn(
                'truncate font-serif text-base font-medium',
                'text-stone-800 dark:text-stone-100'
              )}
            >
              {title}
            </h3>

            <div className="flex items-center">
              <span className={cn('font-serif text-xs text-stone-500')}>
                {date}
              </span>

              {/* More options button - hidden in selection mode */}
              {!isSelectionMode && (
                <div
                  className={cn('ml-2', 'transition-opacity duration-200')}
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    onClick={e => {
                      const dropdownId = `history-dropdown-${conversation.id}`;
                      const buttonRect =
                        e.currentTarget.getBoundingClientRect();

                      // Adjust dropdown position, offset left to ensure full visibility
                      const position = {
                        top: buttonRect.bottom + 5, // Offset down 5px for spacing
                        left: buttonRect.left - 120, // Offset left to center menu below button
                      };
                      useDropdownStore
                        .getState()
                        .toggleDropdown(dropdownId, position);
                    }}
                    className={cn(
                      'rounded-md p-1 transition-all duration-200 ease-in-out',
                      'cursor-pointer',
                      'hover:bg-black/5 dark:hover:bg-white/10',
                      'hover:scale-110',
                      'active:bg-black/10 dark:active:bg-white/20',
                      'focus-visible:ring-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2'
                    )}
                    data-more-button-id={`history-dropdown-${conversation.id}`}
                    aria-label={t('moreOptions')}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>

                  {/* Dropdown menu content */}
                  <DropdownMenu
                    id={`history-dropdown-${conversation.id}`}
                    minWidth={150}
                    className={cn(
                      'border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800',
                      'overflow-hidden rounded-md shadow-lg' // Add shadow and rounded corners
                    )}
                  >
                    <DropdownMenu.Item
                      icon={<Pen className="h-3.5 w-3.5" />}
                      onClick={() => handleRename(conversation)}
                      className="cursor-pointer"
                    >
                      {t('rename')}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      icon={<Trash className="h-3.5 w-3.5" />}
                      danger
                      onClick={() => handleDelete(conversation)}
                      className="cursor-pointer"
                    >
                      {t('delete')}
                    </DropdownMenu.Item>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </div>

          {/* Preview content */}
          <p
            className={cn(
              'line-clamp-2 font-serif text-sm',
              'text-stone-600 dark:text-stone-400'
            )}
          >
            {preview}
          </p>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Render content directly without internal scroll container */}
      {conversations.length === 0 ? (
        // Empty state
        <div
          className={cn(
            'flex h-full flex-col items-center justify-center py-16',
            'text-stone-500 dark:text-stone-400'
          )}
        >
          {searchQuery ? (
            <>
              <Search className="mb-4 h-12 w-12 opacity-50" />
              <p className="text-lg font-medium">{t('noSearchResults')}</p>
              <p className="mt-2 text-sm">{t('searchHint')}</p>
            </>
          ) : (
            <>
              <Archive className="mb-4 h-12 w-12 opacity-50" />
              <p className="text-lg font-medium">{t('noHistoryTitle')}</p>
              <p className="mt-2 text-sm">{t('noHistoryDesc')}</p>
            </>
          )}
        </div>
      ) : (
        // Conversation list
        <div className="flex flex-col pt-2 pb-6">
          {conversations.map(renderConversationItem)}

          {/* Display conversation count info at bottom of list */}
          {conversations.length > 0 && (
            <div
              className={cn(
                'mt-4 flex items-center justify-center border-t py-6',
                'border-stone-300 text-stone-500 dark:border-stone-600'
              )}
            >
              <Clock className="mr-2 h-4 w-4" />
              <span className="text-sm">
                {searchQuery
                  ? t('searchResults', { count: conversations.length })
                  : t('totalRecords', { total })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Rename dialog */}
      <InputDialog
        isOpen={showRenameDialog}
        onClose={() => !isOperating && setShowRenameDialog(false)}
        onConfirm={handleRenameConfirm}
        title={t('renameDialog.title')}
        label={t('renameDialog.label')}
        placeholder={t('renameDialog.placeholder')}
        defaultValue={selectedConversation?.title || t('newChat')}
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
          title: selectedConversation?.title || t('newChat'),
        })}
        confirmText={t('deleteDialog.confirmText')}
        variant="danger"
        icon="delete"
        isLoading={isOperating}
      />
    </>
  );
}
