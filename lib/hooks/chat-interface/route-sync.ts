import { getConversationByExternalId } from '@lib/services/client/conversations-api';

interface SyncChatRouteStateInput {
  currentPathname: string | null;
  setDifyConversationId: (conversationId: string | null) => void;
  setDbConversationUUID: (conversationId: string | null) => void;
  setConversationAppId: (appId: string | null) => void;
}

function isPersistedConversationPath(pathname: string | null): pathname is string {
  return (
    typeof pathname === 'string' &&
    pathname.startsWith('/chat/') &&
    !pathname.includes('/chat/new') &&
    !pathname.includes('/chat/temp-')
  );
}

function isNewOrTempConversationPath(pathname: string | null): boolean {
  return pathname === '/chat/new' || Boolean(pathname?.includes('/chat/temp-'));
}

export async function syncChatRouteState(
  input: SyncChatRouteStateInput
): Promise<void> {
  if (isPersistedConversationPath(input.currentPathname)) {
    const pathConversationId = input.currentPathname.replace('/chat/', '');
    input.setDifyConversationId(pathConversationId);

    try {
      console.log(
        `[Route Listener] Start querying conversation record with external ID ${pathConversationId}`
      );

      const result = await getConversationByExternalId(pathConversationId);

      if (result.success && result.data) {
        console.log(
          `[Route Listener] Found conversation record, dbID=${result.data.id}, original appId=${result.data.app_id}`
        );
        input.setDbConversationUUID(result.data.id);

        if (result.data.app_id) {
          input.setConversationAppId(result.data.app_id);
          console.log(
            `[Route Listener] Set conversation original appId: ${result.data.app_id}`
          );
        } else {
          input.setConversationAppId(null);
          console.log(
            '[Route Listener] No appId in conversation record, will use current selected app'
          );
        }
        return;
      }

      if (result.success && !result.data) {
        console.log(
          `[Route Listener] No conversation record found for external ID ${pathConversationId}`
        );
      } else {
        console.error('[Route Listener] Query conversation record failed:', result.error);
      }
    } catch (error) {
      console.error('[Route Listener] Exception querying conversation record:', error);
    }

    input.setDbConversationUUID(null);
    input.setConversationAppId(null);
    return;
  }

  if (isNewOrTempConversationPath(input.currentPathname)) {
    console.log('[Route Listener] New or temp conversation, reset state');
    input.setDifyConversationId(null);
    input.setDbConversationUUID(null);
    input.setConversationAppId(null);
  }
}
