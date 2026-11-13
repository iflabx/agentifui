'use client';

import { DropdownMenuV2 } from '@components/ui/dropdown-menu-v2';
import { MoreButtonV2 } from '@components/ui/more-button-v2';
import { useFavoriteAppsStore } from '@lib/stores/favorite-apps-store';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';
import { ChevronRight, Edit, HeartOff } from 'lucide-react';

import { useEffect, useState } from 'react';
import React from 'react';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { SidebarListButton } from './sidebar-list-button';

interface FavoriteApp {
  instanceId: string;
  backendType?: 'dify' | 'langchain';
  serviceInstanceId?: string;
  displayName: string;
  description?: string;
  iconUrl?: string;
  appType: 'model' | 'marketplace';
  dify_apptype?:
    'agent' | 'chatbot' | 'text-generation' | 'chatflow' | 'workflow';
}

interface SidebarFavoriteAppsProps {
  contentVisible: boolean;
}

export function SidebarFavoriteApps({
  contentVisible,
}: SidebarFavoriteAppsProps) {
  const router = useRouter();
  const { isExpanded, selectItem, selectedType, selectedId } =
    useSidebarStore();
  const t = useTranslations('sidebar');
  const {
    favoriteApps,
    removeFavoriteApp,
    loadFavoriteApps,
    isLoading,
    // 🎯 New: expand/collapse state management
    isExpanded: isAppsExpanded,
    toggleExpanded,
  } = useFavoriteAppsStore();

  // Dropdown menu state management
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  useEffect(() => {
    loadFavoriteApps();
  }, [loadFavoriteApps]);

  // Listen to the sidebar expansion state, close automatically when dropdown is closed
  useEffect(() => {
    if (!isExpanded && openDropdownId) {
      setOpenDropdownId(null);
    }
  }, [isExpanded, openDropdownId]);

  // Determine the number of apps to display based on the expansion state: 3 when closed, all when expanded
  const displayApps = isAppsExpanded ? favoriteApps : favoriteApps.slice(0, 3);

  // Determine if the application is selected - reference the implementation of chat list
  const isAppActive = React.useCallback((app: FavoriteApp) => {
    // Get the current route path
    const pathname = window.location.pathname;

    // Check if the current route is an application detail page
    if (!pathname.startsWith('/apps/')) return false;

    // 🎯 Fix: support new route structure /apps/{type}/[instanceId]
    const pathParts = pathname.split('/apps/')[1]?.split('/');
    if (!pathParts || pathParts.length < 2) return false;

    const routeAppType = pathParts[0]; // Application type
    const routeInstanceId = pathParts[1]; // Instance ID

    // Basic instanceId matching
    if (app.backendType === 'langchain') {
      return (
        routeAppType === 'langchain' &&
        routeInstanceId === app.serviceInstanceId
      );
    }
    if (routeInstanceId !== app.instanceId) return false;

    // Check if the application type matches
    const appDifyType = app.dify_apptype || 'chatflow';
    return routeAppType === appDifyType;
  }, []);

  // 🎯 Refactor: optimize click handling logic, solve user experience problems
  // 1. Immediately jump to the route, let the page-level spinner handle the loading state
  // 2. Remove button-level loading state to avoid button stuck
  // 3. Simplify application switching logic to avoid verification bounce
  // 4. Keep the immediate feedback of the sidebar selected state
  const handleAppClick = async (app: FavoriteApp) => {
    try {
      console.log(
        '[FavoriteApps] Start switching to favorite apps:',
        app.displayName
      );

      // 🎯 Immediately set the sidebar selected state, provide immediate feedback
      selectItem('app', app.instanceId);

      // 🎯 Immediately jump to the route, let the page-level spinner handle the loading state
      const difyAppType = app.dify_apptype || 'chatflow';
      const targetPath =
        app.backendType === 'langchain' && app.serviceInstanceId
          ? `/apps/langchain/${app.serviceInstanceId}`
          : `/apps/${difyAppType}/${app.instanceId}`;

      console.log('[FavoriteApps] Immediately jump to the route:', targetPath);

      // 🎯 Fix race condition: only jump to the route, let the target page handle the application switching
      // Avoid localStorage state flickering caused by simultaneous call to switchToSpecificApp
      // This is consistent with the behavior of the application market
      router.push(targetPath);

      // 🎯 Remove background application switching call to avoid race condition with the target page's switching logic

      console.log(
        '[FavoriteApps] Route jump initiated, page handles subsequent processing'
      );
    } catch (error) {
      console.error('[FavoriteApps] Failed to switch to favorite apps:', error);

      // 🎯 Error handling: restore sidebar state
      selectItem(null, null);
    }
  };

  // 🎯 Optimize: use the same optimization strategy for starting a new chat
  const handleStartNewChat = async (app: FavoriteApp) => {
    try {
      console.log('[FavoriteApps] Start new chat:', app.displayName);

      // Immediately set the sidebar selected state
      selectItem('app', app.instanceId);

      // Immediately jump, let the page handle the subsequent logic
      const difyAppType = app.dify_apptype || 'chatflow';
      const targetPath =
        app.backendType === 'langchain' && app.serviceInstanceId
          ? `/apps/langchain/${app.serviceInstanceId}`
          : `/apps/${difyAppType}/${app.instanceId}`;

      console.log('[FavoriteApps] Start new chat, jump to:', targetPath);
      router.push(targetPath);

      // 🎯 Remove background application switching call to avoid race condition
      // Let the target page handle the application switching
    } catch (error) {
      console.error('[FavoriteApps] Failed to start new chat:', error);
      selectItem(null, null);
    }
  };

  // Hide application
  const handleHideApp = (app: FavoriteApp) => {
    removeFavoriteApp(app.instanceId);
  };

  // Get application icon
  const getAppIcon = (app: FavoriteApp) => {
    if (app.iconUrl) {
      return (
        <img
          src={app.iconUrl}
          alt={app.displayName}
          className="h-4 w-4 rounded-sm object-cover"
        />
      );
    }

    // 🎨 Modern design: use colorful gradient background + simple icon
    // Generate consistent gradient colors based on application ID, ensuring each application has a unique and stable visual identifier
    // Improve the modern and visual hierarchy of the sidebar
    const getAppGradient = () => {
      const gradients = [
        'bg-gradient-to-br from-blue-400 to-blue-600',
        'bg-gradient-to-br from-purple-400 to-purple-600',
        'bg-gradient-to-br from-pink-400 to-pink-600',
        'bg-gradient-to-br from-green-400 to-green-600',
        'bg-gradient-to-br from-orange-400 to-orange-600',
        'bg-gradient-to-br from-teal-400 to-teal-600',
        'bg-gradient-to-br from-indigo-400 to-indigo-600',
        'bg-gradient-to-br from-cyan-400 to-cyan-600',
      ];

      // Generate consistent hash values based on application ID, ensuring the same application always displays the same color
      const hash = app.instanceId.split('').reduce((a, b) => {
        a = (a << 5) - a + b.charCodeAt(0);
        return a & a;
      }, 0);

      return gradients[Math.abs(hash) % gradients.length];
    };

    return (
      <div
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded-md text-white shadow-sm',
          'transition-all duration-200 group-hover:scale-105',
          getAppGradient()
        )}
      >
        {/* Use simple geometric icons, modern and universal */}
        <div className="h-2 w-2 rounded-sm bg-white/90" />
      </div>
    );
  };

  // Create dropdown menu
  const createMoreActions = (app: FavoriteApp) => {
    const isMenuOpen = openDropdownId === app.instanceId;

    const handleMenuOpenChange = (isOpen: boolean) => {
      setOpenDropdownId(isOpen ? app.instanceId : null);
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
            disabled={false}
            isMenuOpen={isMenuOpen}
            disableHover={!!openDropdownId && !isMenuOpen}
          />
        }
      >
        <DropdownMenuV2.Item
          icon={<Edit className="h-3.5 w-3.5" />}
          onClick={() => {
            // 🎯 Click to immediately close the menu to avoid state conflicts
            setOpenDropdownId(null);
            handleStartNewChat(app);
          }}
          disabled={false}
        >
          {/* Show different button text based on application type */}
          {app.dify_apptype === 'workflow'
            ? t('startWorkflow')
            : app.dify_apptype === 'text-generation'
              ? t('startTextGeneration')
              : t('startChat')}
        </DropdownMenuV2.Item>
        <DropdownMenuV2.Item
          icon={<HeartOff className="h-3.5 w-3.5" />}
          onClick={() => {
            setOpenDropdownId(null);
            handleHideApp(app);
          }}
          disabled={false}
        >
          {t('hideApp')}
        </DropdownMenuV2.Item>
      </DropdownMenuV2>
    );
  };

  // If there are no favorite apps, do not display any content
  if (!isLoading && displayApps.length === 0) {
    return null;
  }

  if (!contentVisible) return null;

  return (
    <div className="flex flex-col">
      {/* Sticky header: maintain original style, only add sticky positioning */}
      {displayApps.length > 0 && (
        <div
          className={cn(
            'group sticky top-0 z-40 ml-[6px] px-2 py-1',
            // Use same background as sidebar for perfect sticky effect
            // Ensure high z-index to cover content below
            'bg-stone-200 dark:bg-stone-700',
            favoriteApps.length > 3 &&
              'cursor-pointer rounded-md transition-all duration-300 ease-out'
          )}
          onClick={favoriteApps.length > 3 ? toggleExpanded : undefined}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              {/* Title text with expand hint */}
              <span
                className={cn(
                  'font-serif text-xs leading-none font-medium',
                  'text-stone-500 dark:text-stone-400'
                )}
              >
                {t('favoriteApps')}
              </span>

              {/* Expand button: only show when there are more than 3 apps */}
              {favoriteApps.length > 3 && (
                <ChevronRight
                  className={cn(
                    'ml-1.5 h-3 w-3 transition-all duration-300 ease-out',
                    'transform-gpu will-change-transform',
                    isAppsExpanded && 'rotate-90',
                    'text-stone-500/80 dark:text-stone-400/80'
                  )}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div
          className={cn(
            'px-3 py-1 font-serif text-xs',
            'text-gray-400 dark:text-gray-500'
          )}
        >
          {t('loading')}
        </div>
      )}

      {/* App list: add top spacing, maintain separation from title */}
      {displayApps.length > 0 && (
        <div className="space-y-1 px-3 pt-1">
          {displayApps.map((app, index) => {
            // Fix cross-page switching delay: allow sidebar store state to take effect immediately during routing
            // 1. If this app is selected in sidebar store, show as selected immediately (during route transition)
            // 2. If on non-app page and not selected in store, ensure no selected state is shown
            const isInAppPage = window.location.pathname.startsWith('/apps/');
            const isSelectedByStore =
              selectedType === 'app' && selectedId === app.instanceId;
            const isSelected =
              isSelectedByStore || (isInAppPage && isAppActive(app));
            // Calculate if this is an extended item (apps beyond the first 3)
            const isExtendedItem = index >= 3;

            return (
              <div
                className={cn(
                  'group relative transition-all duration-300 ease-out',
                  'transform-gpu will-change-transform',
                  // Enhanced animation for extended items
                  isExtendedItem && !isAppsExpanded
                    ? 'pointer-events-none translate-y-[-4px] scale-95 opacity-0'
                    : 'translate-y-0 scale-100 opacity-100',
                  // Staggered animation delay for extended items
                  isExtendedItem &&
                    isAppsExpanded &&
                    `animation-delay-${(index - 3) * 50}`
                )}
                style={{
                  animationDelay:
                    isExtendedItem && isAppsExpanded
                      ? `${(index - 3) * 50}ms`
                      : '0ms',
                }}
                key={app.instanceId}
              >
                <SidebarListButton
                  icon={getAppIcon(app)}
                  onClick={() => handleAppClick(app)}
                  active={isSelected}
                  isLoading={false}
                  hasOpenDropdown={openDropdownId === app.instanceId}
                  disableHover={!!openDropdownId}
                  moreActionsTrigger={
                    <div
                      className={cn(
                        'transition-opacity',
                        // Hide more button when clicking to avoid interference
                        openDropdownId === app.instanceId
                          ? 'opacity-100' // The item with the open menu, the more button should be displayed
                          : openDropdownId
                            ? 'opacity-0' // When there are other menus open, the more button of this item is not displayed
                            : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100' // Hover display under normal state
                      )}
                    >
                      {createMoreActions(app)}
                    </div>
                  }
                  className={cn(
                    'w-full justify-start font-medium',
                    'transition-all duration-200 ease-in-out',
                    // Special styling when clicking
                    // Unified hover effect: keep completely consistent with header
                    // Use same stone-300/80 and stone-600/60 as header
                    'text-gray-700 hover:bg-stone-300/80 hover:text-gray-900',
                    'dark:text-gray-300 dark:hover:bg-stone-600/60 dark:hover:text-gray-100'
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center">
                    {/* App name - use consistent styling with recent chats */}
                    <span className="truncate font-serif text-xs font-medium">
                      {app.displayName}
                    </span>
                    {/* Show status hint when clicking */}
                  </div>
                </SidebarListButton>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
