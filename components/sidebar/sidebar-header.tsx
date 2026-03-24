'use client';

import { KeyCombination } from '@components/ui/adaptive-key-badge';
import { TooltipWrapper } from '@components/ui/tooltip-wrapper';
import { WidePanelLeft } from '@components/ui/wide-panel-left';
import { useChatInterface } from '@lib/hooks/use-chat-interface';
import { useFormattedShortcut } from '@lib/hooks/use-platform-keys';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useChatTransitionStore } from '@lib/stores/chat-transition-store';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Clock,
  Edit,
  LayoutGrid,
} from 'lucide-react';

import React from 'react';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';

import { SidebarButton } from './sidebar-button';

interface SidebarHeaderProps {
  isHovering?: boolean;
}

export function SidebarHeader({ isHovering = false }: SidebarHeaderProps) {
  const { isExpanded, toggleSidebar } = useSidebarStore();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const t = useTranslations('sidebar');

  const { selectedType, selectedId, selectItem } = useSidebarStore();
  const isNewChatActive =
    pathname === '/chat/new' && (selectedType !== 'chat' || !selectedId);
  const isHistoryActive = pathname === '/chat/history';
  const isAppsActive = pathname === '/apps';

  const newChatShortcut = useFormattedShortcut('NEW_CHAT');
  const recentChatsShortcut = useFormattedShortcut('RECENT_CHATS');
  const appsMarketShortcut = useFormattedShortcut('APPS_MARKET');

  const [isClicking, setIsClicking] = React.useState(false);

  const setCurrentConversationId = useChatStore(
    state => state.setCurrentConversationId
  );
  const clearMessages = useChatStore(state => state.clearMessages);
  const setIsWaitingForResponse = useChatStore(
    state => state.setIsWaitingForResponse
  );
  const { setIsWelcomeScreen } = useChatInputStore();
  const { setIsTransitioningToWelcome } = useChatTransitionStore();
  const { clearConversationState } = useChatInterface();

  const handleNewChat = () => {
    const isAlreadyOnNewChat = window.location.pathname === '/chat/new';
    if (isAlreadyOnNewChat) {
      return;
    }

    // Immediately route to the new chat page
    router.push('/chat/new');

    // Delay cleaning state to ensure routing is complete
    setTimeout(() => {
      // Clean chatStore state
      useChatStore.getState().clearMessages();
      clearMessages();
      setCurrentConversationId(null);

      // 🎯 New: clean the conversation state in use-chat-interface
      // This ensures that difyConversationId, dbConversationUUID, and conversationAppId are correctly cleaned
      clearConversationState();

      // Clean other UI states
      setIsWelcomeScreen(true);
      setIsTransitioningToWelcome(true);
      setIsWaitingForResponse(false);

      const { selectItem } = useSidebarStore.getState();
      selectItem('chat', null, true);
    }, 100);
  };

  return (
    <div className={cn('flex flex-col gap-2 px-3 py-4')}>
      {/* Layout container - horizontal arrangement of buttons and text when expanded */}
      <div className={cn('flex items-center', isExpanded ? 'gap-2' : '')}>
        {/* Sidebar control button - fixed size, shows window icon by default, fades to arrow icon on hover */}
        {/* Shows right-side tooltip in slim state */}
        {!isExpanded ? (
          <TooltipWrapper
            content={t('expand')}
            id="sidebar-header-expand-tooltip"
            placement="right"
            size="sm"
            showArrow={false}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={e => {
                e.currentTarget.blur();
                setIsClicking(true);
                toggleSidebar();
                setTimeout(() => {
                  setIsClicking(false);
                }, 200);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleSidebar();
                }
              }}
              aria-label={t('expand')}
              className={cn(
                'group relative flex items-center justify-center px-2 py-2 text-sm font-medium',
                // Use resize cursor to indicate that the sidebar width can be adjusted: right arrow when expanded, left arrow when collapsed
                'cursor-e-resize',
                'transition-all duration-150 ease-in-out',
                'outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                'select-none',
                'focus-visible:ring-primary focus-visible:ring-offset-background dark:focus-visible:ring-stone-500 dark:focus-visible:ring-offset-gray-900',
                'border border-transparent',
                'h-10 w-10',
                'text-gray-200',
                '[margin-left:1px]'
              )}
            >
              {/* 🎨 Internal background - collapsed state only displays on hover */}
              <div
                className={cn(
                  'absolute inset-0 rounded-lg transition-all duration-150 ease-in-out',
                  'group-hover:bg-stone-200/70 dark:group-hover:bg-stone-700/60'
                )}
              />

              {/* Icon container - contains default icon and hover icon overlay effects */}
              <span
                className={cn(
                  'relative z-10 flex h-5 w-5 flex-shrink-0 items-center justify-center',
                  'text-gray-500 group-hover:text-stone-800 dark:text-gray-400 dark:group-hover:text-white'
                )}
              >
                {/* Default icon - wide panel window icon, only displayed when not hovering and not clicking */}
                <WidePanelLeft
                  className={cn(
                    'absolute h-5 w-5 transition-all duration-150 ease-out',
                    // Collapsed state: hide window icon when sidebar is hovered and enlarge
                    isHovering && 'scale-110 opacity-0',
                    // Button hover: hide window icon and add a larger zoom effect
                    'group-hover:scale-125 group-hover:opacity-0',
                    // Click to immediately hide the window icon
                    isClicking && 'scale-110 opacity-0'
                  )}
                />

                {/* Hover icon - right arrow, displayed when hovering or clicking in collapsed state */}
                <ArrowRightToLine
                  className={cn(
                    'absolute h-4 w-4 transition-all duration-150 ease-out',
                    // Collapsed state: sidebar hover, button hover, or click to display arrow
                    isHovering || isClicking
                      ? 'scale-110 opacity-100'
                      : 'scale-102 opacity-0',
                    'group-hover:opacity-100' // 🎨 Remove zoom effect
                  )}
                />
              </span>
            </div>
          </TooltipWrapper>
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={e => {
              e.currentTarget.blur();
              setIsClicking(true);
              toggleSidebar();
              setTimeout(() => {
                setIsClicking(false);
              }, 200);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSidebar();
              }
            }}
            aria-label={t('collapse')}
            className={cn(
              'group relative flex items-center justify-center px-2 py-2 text-sm font-medium',
              // Use resize cursor to indicate that the sidebar width can be adjusted: left arrow when expanded, right arrow when collapsed
              'cursor-w-resize',
              'transition-all duration-150 ease-in-out',
              'outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              'select-none',
              'focus-visible:ring-primary focus-visible:ring-offset-background dark:focus-visible:ring-stone-500 dark:focus-visible:ring-offset-gray-900',
              'border border-transparent',
              'h-10 w-10',
              '[margin-left:1px]'
            )}
          >
            {/* 🎨 Internal background - expanded state displays by default, enhanced when hovering */}
            <div
              className={cn(
                'absolute inset-0 rounded-lg transition-all duration-150 ease-in-out',
                // Expanded state: default has background color, enhanced when hovering
                'bg-stone-300/50 group-hover:bg-stone-300/80 dark:bg-stone-600/50 dark:group-hover:bg-stone-600/70'
              )}
            />

            {/* Icon container - contains default icon and hover icon overlay effects */}
            <span
              className={cn(
                'relative z-10 flex h-5 w-5 flex-shrink-0 items-center justify-center',
                'text-gray-500 group-hover:text-stone-800 dark:text-gray-400 dark:group-hover:text-white'
              )}
            >
              {/* Default icon - wide panel window icon, only displayed when not hovering and not clicking */}
              <WidePanelLeft
                className={cn(
                  'absolute h-5 w-5 transition-all duration-150 ease-out',
                  // Button hover: hide window icon and add a larger zoom effect
                  'group-hover:scale-125 group-hover:opacity-0',
                  // Click to immediately hide the window icon
                  isClicking && 'scale-110 opacity-0'
                )}
              />

              {/* Hover icon - left arrow, displayed when hovering or clicking in expanded state */}
              <ArrowLeftToLine
                className={cn(
                  'absolute h-4 w-4 transition-all duration-150 ease-out',
                  // Expanded state: display arrow when button is hovered or clicked
                  isClicking ? 'scale-110 opacity-100' : 'scale-102 opacity-0',
                  'group-hover:opacity-100' // 🎨 Remove zoom effect
                )}
              />
            </span>
          </div>
        )}

        {/* Project name - displayed as independent text when expanded, style consistent with buttons */}
        {isExpanded && (
          <div
            className={cn(
              'min-w-0 flex-1 truncate',
              'flex items-center leading-none',
              'font-display text-base font-bold tracking-wide',
              '-mt-0.5 -ml-1', // Fine-tune: move up a little, move right to align with the button
              'text-stone-700 dark:text-gray-100'
            )}
          >
            <span
              className={cn(
                'bg-gradient-to-r bg-clip-text text-transparent',
                'from-stone-700 via-stone-800 to-stone-900 dark:from-gray-100 dark:via-gray-200 dark:to-gray-300'
              )}
            >
              {t('appName')}
            </span>
          </div>
        )}
      </div>

      {/* 🎯 New chat button - important function, responsive design highlights */}
      {isExpanded ? (
        <SidebarButton
          icon={
            <Edit
              className={cn(
                'h-5 w-5 transition-all duration-150 ease-out',
                'text-stone-600 group-hover:text-stone-800 dark:text-gray-300 dark:group-hover:text-white'
              )}
            />
          }
          active={isNewChatActive}
          onClick={handleNewChat}
          aria-label={t('newChat')}
          variant="transparent"
          className={cn(
            'group font-medium transition-all duration-150 ease-out',
            'flex w-full items-center justify-between'
          )}
        >
          <span className="font-serif">{t('newChat')}</span>
          {/* Displayed when hovering */}
          <div
            className={cn(
              'opacity-0 transition-opacity duration-200 group-hover:opacity-60',
              'ml-auto'
            )}
          >
            <KeyCombination keys={newChatShortcut.symbols} size="md" />
          </div>
        </SidebarButton>
      ) : (
        <TooltipWrapper
          content={
            <div className="flex items-center gap-2.5">
              <span>{t('newChat')}</span>
              <KeyCombination keys={newChatShortcut.symbols} size="sm" />
            </div>
          }
          id="sidebar-header-new-chat-tooltip"
          placement="right"
          size="sm"
          showArrow={false}
        >
          <SidebarButton
            icon={
              <Edit
                className={cn(
                  'h-5 w-5 transition-all duration-150 ease-out',
                  'text-stone-600 group-hover:text-stone-800 dark:text-gray-300 dark:group-hover:text-white'
                )}
              />
            }
            active={isNewChatActive}
            onClick={handleNewChat}
            aria-label={t('newChat')}
            variant="transparent"
            className={cn(
              'group font-medium transition-all duration-150 ease-out'
            )}
          >
            <span className="font-serif">{t('newChat')}</span>
          </SidebarButton>
        </TooltipWrapper>
      )}

      {/* 🎯 History chat button - important function, displayed alongside the new chat button */}
      {isExpanded ? (
        <SidebarButton
          icon={
            <Clock
              className={cn(
                'h-5 w-5 transition-all duration-150 ease-out',
                'text-stone-600 group-hover:text-stone-800 dark:text-gray-300 dark:group-hover:text-white'
              )}
            />
          }
          active={isHistoryActive}
          onClick={() => {
            selectItem(null, null);
            router.push('/chat/history');
          }}
          aria-label={t('historyChats')}
          variant="transparent"
          className={cn(
            'group font-medium transition-all duration-150 ease-out',
            'flex w-full items-center justify-between'
          )}
        >
          <span className="font-serif">{t('historyChats')}</span>
          {/* Displayed when hovering */}
          <div
            className={cn(
              'opacity-0 transition-opacity duration-200 group-hover:opacity-60',
              'ml-auto'
            )}
          >
            <KeyCombination keys={recentChatsShortcut.symbols} size="md" />
          </div>
        </SidebarButton>
      ) : (
        <TooltipWrapper
          content={
            <div className="flex items-center gap-2.5">
              <span>{t('historyChats')}</span>
              <KeyCombination keys={recentChatsShortcut.symbols} size="sm" />
            </div>
          }
          id="sidebar-header-history-tooltip"
          placement="right"
          size="sm"
          showArrow={false}
        >
          <SidebarButton
            icon={
              <Clock
                className={cn(
                  'h-5 w-5 transition-all duration-150 ease-out',
                  'text-stone-600 group-hover:text-stone-800 dark:text-gray-300 dark:group-hover:text-white'
                )}
              />
            }
            active={isHistoryActive}
            onClick={() => {
              selectItem(null, null);
              router.push('/chat/history');
            }}
            aria-label={t('historyChats')}
            variant="transparent"
            className={cn(
              'group font-medium transition-all duration-150 ease-out'
            )}
          >
            <span className="font-serif">{t('historyChats')}</span>
          </SidebarButton>
        </TooltipWrapper>
      )}

      {/* 🎯 Apps market button - completely consistent with the new chat button style */}
      {isExpanded ? (
        <SidebarButton
          icon={
            <LayoutGrid
              className={cn(
                'h-5 w-5 transition-all duration-150 ease-out',
                'text-stone-600 group-hover:text-stone-800 dark:text-gray-300 dark:group-hover:text-white'
              )}
            />
          }
          active={isAppsActive}
          onClick={() => {
            router.push('/apps');
          }}
          aria-label={t('appsMarket')}
          variant="transparent"
          className={cn(
            'group font-medium transition-all duration-150 ease-out',
            'flex w-full items-center justify-between'
          )}
        >
          <span className="font-serif">{t('appsMarket')}</span>
          {/* Displayed when hovering */}
          <div
            className={cn(
              'opacity-0 transition-opacity duration-200 group-hover:opacity-60',
              'ml-auto'
            )}
          >
            <KeyCombination keys={appsMarketShortcut.symbols} size="md" />
          </div>
        </SidebarButton>
      ) : (
        <TooltipWrapper
          content={
            <div className="flex items-center gap-2.5">
              <span>{t('appsMarket')}</span>
              <KeyCombination keys={appsMarketShortcut.symbols} size="sm" />
            </div>
          }
          id="sidebar-header-apps-tooltip"
          placement="right"
          size="sm"
          showArrow={false}
        >
          <SidebarButton
            icon={
              <LayoutGrid
                className={cn(
                  'h-5 w-5 transition-all duration-150 ease-out',
                  'text-stone-600 group-hover:text-stone-800 dark:text-gray-300 dark:group-hover:text-white'
                )}
              />
            }
            active={isAppsActive}
            onClick={() => {
              router.push('/apps');
            }}
            aria-label={t('appsMarket')}
            variant="transparent"
            className={cn(
              'group font-medium transition-all duration-150 ease-out'
            )}
          >
            <span className="font-serif">{t('appsMarket')}</span>
          </SidebarButton>
        </TooltipWrapper>
      )}
    </div>
  );
}
