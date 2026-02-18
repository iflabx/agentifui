'use client';

import {
  type CombinedConversation,
  useCombinedConversations,
} from '@lib/hooks/use-combined-conversations';
import { type AppInfo, useAppListStore } from '@lib/stores/app-list-store';
import { useChatStore } from '@lib/stores/chat-store';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';

/**
 * Dynamic Title Component - Refactored Version
 *
 * Adopts a stable title management strategy to prevent title rollback issues caused by state conflicts
 * Core principles:
 * 1. Priority Management: Clearly define the priority of different data sources
 * 2. Debounce Mechanism: Avoid frequent title updates
 * 3. State Caching: Preserve the last valid title as a fallback
 * 4. Separation of Concerns: Separate the title calculation logic from the state listening
 */
export function DynamicTitle() {
  // --- Internationalization Translation ---
  const t = useTranslations('dynamicTitle');

  // --- State Acquisition ---
  const pathname = usePathname();
  const currentConversationId = useChatStore(
    state => state.currentConversationId
  );
  const { conversations, isLoading: isConversationsLoading } =
    useCombinedConversations();
  const { apps, isLoading: isAppsLoading } = useAppListStore();

  // --- Local State Management ---
  const [currentTitle, setCurrentTitle] = useState<string>('AgentifUI');
  const [_isUpdating, setIsUpdating] = useState(false);

  // --- State Caching ---
  const stableStateRef = useRef<{
    lastValidConversationTitle: string | null;
    lastValidAppTitle: string | null;
    lastKnownConversationId: string | null;
    titleUpdateCount: number;
  }>({
    lastValidConversationTitle: null,
    lastValidAppTitle: null,
    lastKnownConversationId: null,
    titleUpdateCount: 0,
  });

  // --- Debounce Timer ---
  const updateTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // base application name
  const baseTitle = t('base');

  // --- Helper Function: Get Settings Page Title ---
  const getSettingsTitle = useCallback(
    (path: string): string => {
      if (path === '/settings') return `${t('settings.main')} | ${baseTitle}`;
      if (path === '/settings/profile')
        return `${t('settings.profile')} | ${baseTitle}`;
      if (path === '/settings/account')
        return `${t('settings.account')} | ${baseTitle}`;
      if (path === '/settings/appearance')
        return `${t('settings.appearance')} | ${baseTitle}`;
      if (path === '/settings/language')
        return `${t('settings.language')} | ${baseTitle}`;

      const settingName = path.split('/').pop() || '';
      const formattedName =
        settingName.charAt(0).toUpperCase() + settingName.slice(1);
      return `${t('settings.main')} - ${formattedName} | ${baseTitle}`;
    },
    [baseTitle, t]
  );

  // --- Helper Function: Get Admin Page Title ---
  const getAdminTitle = useCallback(
    (path: string): string => {
      if (path === '/admin') return `${t('admin.main')} | ${baseTitle}`;
      if (path === '/admin/users') return `${t('admin.users')} | ${baseTitle}`;
      if (path === '/admin/api-config')
        return `${t('admin.apiConfig')} | ${baseTitle}`;
      if (path === '/admin/security')
        return `${t('admin.security')} | ${baseTitle}`;
      if (path === '/admin/analytics')
        return `${t('admin.analytics')} | ${baseTitle}`;
      if (path === '/admin/content')
        return `${t('admin.content')} | ${baseTitle}`;
      if (path === '/admin/errors')
        return `${t('admin.errors')} | ${baseTitle}`;

      const adminSection = path.split('/').pop() || '';
      const formattedName =
        adminSection.charAt(0).toUpperCase() + adminSection.slice(1);
      return `${t('admin.main')} - ${formattedName} | ${baseTitle}`;
    },
    [baseTitle, t]
  );

  // --- Helper Function: Get Application Title ---
  const getAppTitle = useCallback(
    (
      path: string,
      appsList: AppInfo[],
      isLoading: boolean
    ): { title: string; isStable: boolean } => {
      const pathSegments = path.split('/');
      if (pathSegments.length >= 4) {
        const instanceId = pathSegments[3];

        const targetApp = appsList.find(app => app.instance_id === instanceId);
        if (targetApp) {
          const appDisplayName =
            targetApp.display_name || targetApp.name || instanceId;
          return {
            title: `${appDisplayName} | ${baseTitle}`,
            isStable: true,
          };
        }

        if (isLoading) {
          return {
            title: `${t('apps.loading')} | ${baseTitle}`,
            isStable: false,
          };
        }
      }

      return { title: baseTitle, isStable: false };
    },
    [baseTitle, t]
  );

  // --- Helper Function: Get Chat Title ---
  const getChatTitle = useCallback(
    (
      conversationId: string,
      conversationsList: CombinedConversation[],
      isLoading: boolean
    ): { title: string; isStable: boolean } => {
      const currentChat = conversationsList.find(
        chat => chat.id === conversationId || chat.tempId === conversationId
      );

      if (currentChat) {
        const chatTitle = currentChat.title || t('chat.new');
        return {
          title: `${chatTitle} | ${baseTitle}`,
          isStable: true,
        };
      }

      if (isLoading) {
        return {
          title: `${t('chat.loading')} | ${baseTitle}`,
          isStable: false,
        };
      }

      return { title: baseTitle, isStable: false };
    },
    [baseTitle, t]
  );

  // --- Title Calculation Logic ---
  const calculateTitle = useCallback(
    (
      currentPath: string | null,
      conversationId: string | null,
      conversationsList: CombinedConversation[],
      appsList: AppInfo[],
      isConvLoading: boolean,
      isAppsDataLoading: boolean
    ): { title: string; priority: number; isStable: boolean } => {
      // Priority Explanation: The smaller the number, the higher the priority
      // 1-10: Certain titles (related to routes)
      // 11-20: Dynamic content titles (chat, application)
      // 90+: fallback titles

      try {
        // --- Static Route Titles (highest priority, most stable) ---
        if (currentPath?.startsWith('/settings')) {
          const settingsTitle = getSettingsTitle(currentPath);
          return { title: settingsTitle, priority: 1, isStable: true };
        }

        if (currentPath?.startsWith('/login')) {
          return {
            title: `${t('auth.login')} | ${baseTitle}`,
            priority: 1,
            isStable: true,
          };
        }

        if (currentPath?.startsWith('/register')) {
          return {
            title: `${t('auth.register')} | ${baseTitle}`,
            priority: 1,
            isStable: true,
          };
        }

        if (currentPath?.startsWith('/phone-login')) {
          return {
            title: `${t('auth.phoneLogin')} | ${baseTitle}`,
            priority: 1,
            isStable: true,
          };
        }

        if (currentPath?.startsWith('/admin')) {
          const adminTitle = getAdminTitle(currentPath);
          return { title: adminTitle, priority: 1, isStable: true };
        }

        if (currentPath?.startsWith('/reset-password')) {
          return {
            title: `${t('auth.resetPassword')} | ${baseTitle}`,
            priority: 1,
            isStable: true,
          };
        }

        if (currentPath?.startsWith('/about')) {
          return {
            title: `${t('about')} | ${baseTitle}`,
            priority: 1,
            isStable: true,
          };
        }

        if (currentPath?.startsWith('/forgot-password')) {
          return {
            title: `${t('auth.forgotPassword')} | ${baseTitle}`,
            priority: 1,
            isStable: true,
          };
        }

        if (currentPath?.startsWith('/sso/processing')) {
          return {
            title: `${t('auth.ssoProcessing')} | ${baseTitle}`,
            priority: 1,
            isStable: true,
          };
        }

        // --- Application-related Titles ---
        if (currentPath?.startsWith('/apps')) {
          if (currentPath === '/apps') {
            return {
              title: `${t('apps.market')} | ${baseTitle}`,
              priority: 2,
              isStable: true,
            };
          }

          // Application details page - enhanced matching logic
          const appTitle = getAppTitle(
            currentPath,
            appsList,
            isAppsDataLoading
          );
          if (appTitle.title !== baseTitle) {
            // successfully get the application title, cache it
            stableStateRef.current.lastValidAppTitle = appTitle.title;
            return {
              title: appTitle.title,
              priority: 11,
              isStable: appTitle.isStable,
            };
          }

          // if the current application title cannot be obtained, but there is a cached application title, use the cached title
          if (stableStateRef.current.lastValidAppTitle) {
            return {
              title: stableStateRef.current.lastValidAppTitle,
              priority: 85,
              isStable: false,
            };
          }

          // provide more specific fallback titles based on the application type
          if (currentPath.includes('/agent/')) {
            return {
              title: `${t('apps.agent')} | ${baseTitle}`,
              priority: 90,
              isStable: false,
            };
          } else if (currentPath.includes('/chatbot/')) {
            return {
              title: `${t('apps.chatbot')} | ${baseTitle}`,
              priority: 90,
              isStable: false,
            };
          } else if (currentPath.includes('/chatflow/')) {
            return {
              title: `${t('apps.chatflow')} | ${baseTitle}`,
              priority: 90,
              isStable: false,
            };
          } else if (currentPath.includes('/workflow/')) {
            return {
              title: `${t('apps.workflow')} | ${baseTitle}`,
              priority: 90,
              isStable: false,
            };
          } else if (currentPath.includes('/text-generation/')) {
            return {
              title: `${t('apps.textGeneration')} | ${baseTitle}`,
              priority: 90,
              isStable: false,
            };
          }

          return {
            title: `${t('apps.details')} | ${baseTitle}`,
            priority: 95,
            isStable: false,
          };
        }

        // --- Chat-related Titles ---
        if (currentPath?.startsWith('/chat')) {
          if (currentPath === '/chat/new') {
            return {
              title: `${t('chat.new')} | ${baseTitle}`,
              priority: 2,
              isStable: true,
            };
          }

          if (currentPath === '/chat/history') {
            return {
              title: `${t('chat.history')} | ${baseTitle}`,
              priority: 2,
              isStable: true,
            };
          }

          if (conversationId) {
            const chatTitle = getChatTitle(
              conversationId,
              conversationsList,
              isConvLoading
            );

            if (
              chatTitle.title !== baseTitle &&
              !chatTitle.title.includes(t('chat.loading'))
            ) {
              // successfully get the conversation title, cache it
              stableStateRef.current.lastValidConversationTitle =
                chatTitle.title;
              stableStateRef.current.lastKnownConversationId = conversationId;
              return {
                title: chatTitle.title,
                priority: 12,
                isStable: chatTitle.isStable,
              };
            }

            // if the current conversation ID is the same as the last known one, and there is a cached title, use the cached title
            if (
              conversationId ===
                stableStateRef.current.lastKnownConversationId &&
              stableStateRef.current.lastValidConversationTitle
            ) {
              return {
                title: stableStateRef.current.lastValidConversationTitle,
                priority: 80,
                isStable: false,
              };
            }

            // the conversation data is still loading, use a gentle loading hint
            if (isConvLoading) {
              return {
                title: `${t('chat.loading')} | ${baseTitle}`,
                priority: 95,
                isStable: false,
              };
            }

            // completely cannot find the conversation
            return {
              title: `${t('chat.notFound')} | ${baseTitle}`,
              priority: 98,
              isStable: false,
            };
          }

          // on the chat page but no specific conversation ID, default case
          if (currentPath === '/chat') {
            return {
              title: `${t('chat.main')} | ${baseTitle}`,
              priority: 3,
              isStable: true,
            };
          }

          // other chat sub-pages
          return {
            title: `${t('chat.main')} | ${baseTitle}`,
            priority: 4,
            isStable: true,
          };
        }

        // --- Default Homepage ---
        return { title: baseTitle, priority: 99, isStable: true };
      } catch (error) {
        console.error('Error calculating title:', error);
        return { title: baseTitle, priority: 100, isStable: false };
      }
    },
    [baseTitle, getSettingsTitle, getAdminTitle, getAppTitle, getChatTitle]
  );

  // --- Debounce Update Title ---
  const debouncedUpdateTitle = useCallback(
    (newTitle: string, priority: number, isStable: boolean) => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }

      // if it is a stable high-priority title, update immediately
      if (isStable && priority <= 10) {
        setCurrentTitle(newTitle);
        document.title = newTitle;
        stableStateRef.current.titleUpdateCount++;
        return;
      }

      // for other cases, use debounce
      updateTimeoutRef.current = setTimeout(
        () => {
          setCurrentTitle(newTitle);
          document.title = newTitle;
          stableStateRef.current.titleUpdateCount++;
        },
        isStable ? 50 : 200
      ); // stable title delay shorter
    },
    []
  );

  // --- Intelligent Title Update Logic ---
  const titleInfo = useMemo(
    () =>
      calculateTitle(
        pathname,
        currentConversationId,
        conversations,
        apps,
        isConversationsLoading,
        isAppsLoading
      ),
    [
      pathname,
      currentConversationId,
      conversations,
      apps,
      isConversationsLoading,
      isAppsLoading,
      calculateTitle,
    ]
  );

  // --- Main Side Effects: Listen to Title Changes ---
  useEffect(() => {
    setIsUpdating(true);

    const { title: newTitle, priority, isStable } = titleInfo;

    // only update when the title really changes
    if (newTitle !== currentTitle) {
      console.log(
        `[DynamicTitle] Title Updated: "${currentTitle}" -> "${newTitle}" (Priority: ${priority}, Stable: ${isStable})`
      );
      debouncedUpdateTitle(newTitle, priority, isStable);
    }

    setIsUpdating(false);
  }, [titleInfo, currentTitle, debouncedUpdateTitle]);

  // --- Clean Up Side Effects ---
  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, []);

  // --- Reset Title When Component Unmounts ---
  useEffect(() => {
    return () => {
      if (
        document.title.includes(t('chat.loading')) ||
        document.title.includes(t('apps.loading'))
      ) {
        document.title = baseTitle;
      }
    };
  }, [baseTitle, t]);

  return null;
}
