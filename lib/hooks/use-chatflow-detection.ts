import { useChatInterface } from '@lib/hooks/use-chat-interface';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import { useAppListStore } from '@lib/stores/app-list-store';

import React from 'react';

/**
 * Chatflow detection hook
 *
 * Features:
 * - Automatically loads the app list if not loaded
 * - Detects the app type based on conversation history
 * - Determines if the current app is a chatflow app
 */
export function useChatflowDetection() {
  const { apps, fetchApps } = useAppListStore();
  const { currentAppInstance } = useCurrentApp();
  const { conversationAppId } = useChatInterface();

  // Ensure the app list is loaded
  React.useEffect(() => {
    if (apps.length === 0) {
      fetchApps();
    }
  }, [apps.length, fetchApps]);

  // Get the app associated with the current conversation
  const currentConversationApp = React.useMemo(() => {
    if (conversationAppId) {
      // Try to find the app by matching instance_id or id
      return apps.find(
        app =>
          app.instance_id === conversationAppId || app.id === conversationAppId
      );
    }
    return currentAppInstance;
  }, [conversationAppId, apps, currentAppInstance]);

  // Determine if the current app is a chatflow app
  const isChatflowApp = React.useMemo(() => {
    if (!currentConversationApp) return false;

    const appRecord = currentConversationApp as unknown as Record<
      string,
      unknown
    >;
    const legacyDifyAppType =
      typeof appRecord.difyAppType === 'string'
        ? appRecord.difyAppType
        : typeof appRecord.dify_apptype === 'string'
          ? appRecord.dify_apptype
          : undefined;

    const difyAppType =
      currentConversationApp.config?.app_metadata?.dify_apptype ||
      legacyDifyAppType;

    return difyAppType === 'chatflow';
  }, [currentConversationApp]);

  return {
    isChatflowApp,
    currentConversationApp,
    conversationAppId,
    isLoading: apps.length === 0,
  };
}
