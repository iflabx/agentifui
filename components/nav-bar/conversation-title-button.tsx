'use client';

import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { InputDialog } from '@components/ui/input-dialog';
// 🎯 Add: import full conversation list hook, used to find historical conversations
import { useAllConversations } from '@lib/hooks/use-all-conversations';
// Import chat interface hook to get conversation associated application ID
import { useChatInterface } from '@lib/hooks/use-chat-interface';
import {
  CombinedConversation,
  conversationEvents,
  useCombinedConversations,
} from '@lib/hooks/use-combined-conversations';
import {
  deleteConversation,
  renameConversation,
} from '@lib/services/client/conversations-api';
import { useAppListStore } from '@lib/stores/app-list-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useFavoriteAppsStore } from '@lib/stores/favorite-apps-store';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';
import { ChevronDown, ChevronUp, Heart, Pen, Trash } from 'lucide-react';

import React, { useMemo, useState } from 'react';

import { useTranslations } from 'next-intl';
import { useParams, usePathname, useRouter } from 'next/navigation';

interface ConversationTitleButtonProps {
  className?: string;
}

export function ConversationTitleButton({
  className,
}: ConversationTitleButtonProps) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const params = useParams();
  const routeInstanceId =
    typeof params?.instanceId === 'string' ? params.instanceId : undefined;
  const { currentConversationId } = useChatStore();
  const { selectItem } = useSidebarStore();
  const { conversations, refresh } = useCombinedConversations();
  const t = useTranslations('navbar.conversation');
  // 🎯 Add: get full conversation list, used to find historical conversation titles
  const { conversations: allConversations } = useAllConversations();
  const [isOpen, setIsOpen] = useState(false);
  const [isOperating, setIsOperating] = useState(false);

  // Application related states
  const { apps } = useAppListStore();
  const { addFavoriteApp, removeFavoriteApp, isFavorite } =
    useFavoriteAppsStore();

  // Get conversation associated application ID, used to display application name label
  const { conversationAppId } = useChatInterface();

  // Modal box status management
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Check if it is a historical conversation page: must be in the format /chat/[conversationId], and not /chat/new
  const isHistoricalChatPage = React.useMemo(() => {
    if (!pathname) return false;

    const chatMatch = pathname.match(/^\/chat\/(.+)$/);
    if (!chatMatch) return false;

    const conversationId = chatMatch[1];
    // Exclude /chat/new page
    return conversationId !== 'new' && conversationId !== 'history';
  }, [pathname]);

  // Check if it is an application detail page: /apps/{type}/[instanceId] format
  const isAppDetailPage =
    pathname &&
    pathname.startsWith('/apps/') &&
    pathname.split('/').length === 4;

  // Get current application information (only in application detail page)
  const currentApp = useMemo(() => {
    if (!isAppDetailPage || !routeInstanceId) return null;
    return apps.find(app => app.instance_id === routeInstanceId);
  }, [isAppDetailPage, routeInstanceId, apps]);

  // 🎯 Fix: use the same data source as sidebar, remove complex backup mechanism
  // This ensures that the navigation bar can correctly display the typewriter effect and real-time title update
  const currentConversation = React.useMemo(() => {
    if (!currentConversationId) return null;

    // Directly search from Combined Conversations, consistent with sidebar
    return (
      conversations.find(
        conv =>
          conv.id === currentConversationId ||
          conv.external_id === currentConversationId
      ) || null
    );
  }, [conversations, currentConversationId]);

  // 🎯 Add: when combinedConversations cannot find conversation, search from full conversation list
  // This ensures that when clicking on historical conversations from the history page, the correct title can be displayed instantly
  const fallbackConversation = React.useMemo(() => {
    if (currentConversation || !currentConversationId) return null;

    // Search for historical conversations from the full conversation list
    const found = allConversations.find(
      conv =>
        conv.external_id === currentConversationId ||
        conv.id === currentConversationId
    );

    if (found) {
      // Convert to CombinedConversation format
      return {
        id: found.external_id || found.id,
        title: found.title,
        user_id: found.user_id,
        created_at: found.created_at,
        updated_at: found.updated_at,
        db_pk: found.id,
        app_id: found.app_id,
        isPending: false,
      } as CombinedConversation;
    }

    return null;
  }, [currentConversation, currentConversationId, allConversations]);

  // Use conversation in combinedConversations first, then use fallback conversation
  const finalConversation = currentConversation || fallbackConversation;

  // 🎯 Add: get current conversation associated application information, used to display application name label
  // Use app_id in conversation record first, then use conversationAppId (used for creating conversation)
  const currentConversationApp = React.useMemo(() => {
    if (!finalConversation && !conversationAppId) return null;

    // Get application ID: use app_id in conversation record first, then use conversationAppId
    const appId = finalConversation?.app_id || conversationAppId;
    if (!appId) return null;

    // Search for the corresponding application in the application list
    return (
      apps.find(app => app.instance_id === appId || app.id === appId) || null
    );
  }, [finalConversation, conversationAppId, apps]);

  // 🎯 Support typewriter effect title display, consistent with sidebar logic
  // 🎯 Fix: when finalConversation is empty but conversationAppId exists, display "Creating..."
  const getDisplayTitle = () => {
    // 🎯 Add: handle conversation creation status
    if (!finalConversation) {
      return conversationAppId ? t('creating') : t('newChat');
    }

    // Check if typewriter effect is needed
    if (finalConversation.isPending && finalConversation.titleTypewriterState) {
      const typewriterState = finalConversation.titleTypewriterState;

      // If typing, display current typing progress
      if (typewriterState.isTyping) {
        return (
          typewriterState.displayTitle ||
          finalConversation.title ||
          t('newChat')
        );
      }

      // If typing is complete, display target title
      if (typewriterState.targetTitle) {
        return typewriterState.targetTitle;
      }
    }

    // Default display conversation title
    return finalConversation.title || t('newChat');
  };

  const conversationTitle = getDisplayTitle();

  // Remove dynamic hiding strategy, now use simple click mode
  const shouldHide = false;

  // Handle rename function - use InputDialog component
  const handleRename = () => {
    setIsOpen(false);
    setShowRenameDialog(true);
  };

  const handleRenameConfirm = async (newTitle: string) => {
    if (!currentConversationId || !finalConversation) {
      alert(t('createInProgress'));
      setShowRenameDialog(false);
      return;
    }

    const dbPK = finalConversation?.db_pk;
    if (!dbPK) {
      alert(t('incompleteInfo'));
      setShowRenameDialog(false);
      return;
    }

    setIsOperating(true);
    try {
      const result = await renameConversation(dbPK, newTitle.trim());

      if (result.success) {
        // After title update, it will be automatically synchronized through refresh() and conversationEvents.emit()

        // Refresh conversation list
        refresh();
        // Trigger global synchronization event, notify all components that data has been updated
        conversationEvents.emit();
        setShowRenameDialog(false);
      } else {
        console.error('Rename conversation failed:', result.error);
        alert(t('renameFailed'));
      }
    } catch (error) {
      console.error('Rename conversation operation error:', error);
      alert(t('operationError'));
    } finally {
      setIsOperating(false);
    }
  };

  // Handle delete function - use ConfirmDialog component
  const handleDelete = () => {
    setIsOpen(false);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    if (!currentConversationId || !finalConversation) {
      alert(t('createInProgress'));
      setShowDeleteDialog(false);
      return;
    }

    const dbPK = finalConversation?.db_pk;
    if (!dbPK) {
      alert(t('incompleteInfo'));
      setShowDeleteDialog(false);
      return;
    }

    setIsOperating(true);
    try {
      const result = await deleteConversation(dbPK);

      if (result.success) {
        // After successful deletion, jump to new conversation page - consistent with sidebar logic
        // Trigger global synchronization event, notify all components that data has been updated
        conversationEvents.emit();
        window.location.href = '/chat/new';
      } else {
        console.error('Delete conversation failed:', result.error);
        alert(t('deleteFailed'));
      }
    } catch (error) {
      console.error('Delete conversation operation error:', error);
      alert(t('operationError'));
    } finally {
      setIsOperating(false);
      setShowDeleteDialog(false);
    }
  };

  // Handle application collection operation (used in application detail page)
  const handleToggleFavorite = async () => {
    if (!currentApp) return;

    try {
      const instanceId = currentApp.instance_id;
      const appMetadata = currentApp.config?.app_metadata;

      if (isFavorite(instanceId)) {
        removeFavoriteApp(instanceId);
      } else {
        await addFavoriteApp({
          instanceId: currentApp.instance_id,
          displayName: currentApp.display_name || currentApp.instance_id,
          description: appMetadata?.brief_description || currentApp.description,
          iconUrl: appMetadata?.icon_url,
          appType: appMetadata?.app_type || 'marketplace',
          dify_apptype: appMetadata?.dify_apptype,
        });

        // After successful collection, update the selected state of the sidebar, ensuring that the frequently used application list is displayed as selected
        selectItem('app', instanceId, true);
      }
    } catch (error) {
      console.error('Collection operation failed:', error);
    }
  };

  // Conditional rendering: display conversation title on historical conversation page, display application information on application detail page
  if (isAppDetailPage && currentApp) {
    // Application detail page rendering
    const appMetadata = currentApp.config?.app_metadata;
    const instanceId = currentApp.instance_id;

    return (
      <div
        className={cn(
          'flex items-center gap-3 transition-all duration-300 ease-in-out',
          shouldHide
            ? 'pointer-events-none -translate-x-2 opacity-0'
            : 'translate-x-0 opacity-100',
          className
        )}
      >
        {/* Application information */}
        <div className="min-w-0 flex-1">
          <h1
            className={cn(
              'truncate font-serif text-sm font-medium',
              'text-stone-900 dark:text-stone-100'
            )}
          >
            {currentApp.display_name || currentApp.instance_id}
          </h1>
          {appMetadata?.brief_description && (
            <p
              className={cn(
                'truncate font-serif text-xs',
                'text-stone-600 dark:text-stone-400'
              )}
            >
              {appMetadata.brief_description}
            </p>
          )}
        </div>

        {/* Tags */}
        {appMetadata?.tags && appMetadata.tags.length > 0 && (
          <div className="hidden flex-shrink-0 gap-1 lg:flex">
            {appMetadata.tags.slice(0, 2).map((tag: string, index: number) => (
              <span
                key={index}
                className={cn(
                  'rounded-full px-2 py-0.5 font-serif text-xs',
                  'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-300'
                )}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Collection button */}
        <button
          onClick={handleToggleFavorite}
          className={cn(
            'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full',
            'transition-all duration-200',
            'hover:scale-110',
            isFavorite(instanceId)
              ? 'bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-stone-100 text-stone-400 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-500 dark:hover:bg-stone-700'
          )}
        >
          <Heart
            className={cn(
              'h-3 w-3 transition-transform',
              isFavorite(instanceId) && 'scale-110 fill-current'
            )}
          />
        </button>

        {/* Application market button */}
        <button
          onClick={() => router.push('/apps')}
          className={cn(
            'flex-shrink-0 rounded-md px-2 py-1 font-serif text-xs transition-colors',
            'text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200'
          )}
        >
          {t('appsMarket')}
        </button>
      </div>
    );
  }

  // Historical conversation page rendering: only display when it is a historical conversation page and there is a current conversation ID
  // 🎯 Fix: when conversationAppId exists (conversation creation), even if finalConversation is empty, it should also be displayed
  if (
    !isHistoricalChatPage ||
    !currentConversationId ||
    (!finalConversation && !conversationAppId)
  ) {
    return null;
  }

  return (
    <>
      <div
        className={cn(
          'relative flex items-center gap-2 transition-all duration-300 ease-in-out',
          // Dynamic hiding strategy: when hovering, the opacity decreases to 0 and moves slightly to the left
          shouldHide
            ? 'pointer-events-none -translate-x-2 opacity-0'
            : 'translate-x-0 opacity-100',
          className
        )}
      >
        {/* Main button: optimized styling, removed left icon, added cursor control logic */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isOperating || !finalConversation}
          className={cn(
            'flex items-center space-x-1 rounded-md px-2 py-1 font-serif text-sm',
            'transition-all duration-200 ease-in-out',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'h-8 min-h-[2rem]',
            // Cursor control: only show pointer when dropdown is closed, not operating, and conversation exists
            !isOpen && !isOperating && finalConversation
              ? 'cursor-pointer'
              : '',
            'text-stone-600 hover:bg-stone-200/80 hover:shadow-sm hover:shadow-stone-300/50 active:bg-stone-300/50 dark:text-stone-300 dark:hover:bg-stone-700/50 dark:hover:shadow-sm dark:hover:shadow-stone-800/20 dark:active:bg-stone-600/50'
          )}
        >
          {/* Conversation title: display title text, only show loading state when operating */}
          <span
            className={cn(
              'font-serif whitespace-nowrap',
              'flex items-center leading-none'
            )}
          >
            {isOperating ? (
              <>
                <div
                  className={cn(
                    'mr-2 inline-block h-3 w-3 animate-pulse rounded-full',
                    'bg-stone-400 dark:bg-stone-500'
                  )}
                />
                {t('loading')}
              </>
            ) : (
              conversationTitle
            )}
          </span>

          {/* Right icon area: shows chevron up/down */}
          <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
            {isOpen ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </div>
        </button>

        {/* Modified: move app name label outside button to avoid being selected together on hover */}
        {currentConversationApp && (
          <span
            className={cn(
              'flex-shrink-0 rounded-full px-2 py-0.5 font-serif text-xs',
              'transition-colors duration-200',
              'border border-stone-300/50 bg-stone-200/80 text-stone-700 dark:border dark:border-stone-600/50 dark:bg-stone-700/80 dark:text-stone-300'
            )}
          >
            {currentConversationApp.display_name ||
              currentConversationApp.instance_id}
          </span>
        )}

        {/* Dropdown menu: completely mimics app-selector styling */}
        {isOpen && (
          <>
            {/* Background mask */}
            <div
              className="fixed inset-0 z-[90]"
              onClick={() => setIsOpen(false)}
            />

            {/* Dropdown options: changed to left alignment to avoid sidebar conflict, reduced horizontal width */}
            <div
              className={cn(
                'absolute top-full left-0 mt-1 max-w-[12rem] min-w-[8rem]',
                'z-[95] overflow-hidden rounded-md shadow-lg',
                'border',
                'border-stone-300/80 bg-stone-50/95 backdrop-blur-sm dark:border-stone-600/80 dark:bg-stone-700/95 dark:backdrop-blur-sm'
              )}
            >
              {/* Rename option */}
              <button
                onClick={handleRename}
                disabled={isOperating}
                className={cn(
                  'w-full px-4 py-3 text-left font-serif text-sm',
                  'whitespace-nowrap transition-colors duration-150',
                  'flex items-center space-x-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  // Add cursor pointer control
                  !isOperating ? 'cursor-pointer' : '',
                  'text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-600/60'
                )}
              >
                <Pen className="h-4 w-4 flex-shrink-0" />
                <span>{t('rename')}</span>
              </button>

              {/* Delete option */}
              <button
                onClick={handleDelete}
                disabled={isOperating}
                className={cn(
                  'w-full px-4 py-3 text-left font-serif text-sm',
                  'whitespace-nowrap transition-colors duration-150',
                  'flex items-center space-x-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  // Add cursor pointer control
                  !isOperating ? 'cursor-pointer' : '',
                  'mb-1',
                  'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300'
                )}
              >
                <Trash className="h-4 w-4 flex-shrink-0" />
                <span>{t('delete')}</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Rename dialog */}
      <InputDialog
        isOpen={showRenameDialog}
        onClose={() => !isOperating && setShowRenameDialog(false)}
        onConfirm={handleRenameConfirm}
        title={t('renameDialog.title')}
        label={t('renameDialog.title')}
        placeholder={t('renameDialog.placeholder')}
        defaultValue={conversationTitle}
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
        message={t('deleteDialog.message', { title: conversationTitle })}
        confirmText={t('deleteDialog.confirmText')}
        variant="danger"
        icon="delete"
        isLoading={isOperating}
      />
    </>
  );
}
