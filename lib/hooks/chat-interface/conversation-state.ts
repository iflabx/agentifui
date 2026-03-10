import { useCallback, useEffect, useState } from 'react';

import { syncChatRouteState } from './route-sync';

interface UseChatConversationStateReturn {
  difyConversationId: string | null;
  setDifyConversationId: (conversationId: string | null) => void;
  dbConversationUUID: string | null;
  setDbConversationUUID: (conversationId: string | null) => void;
  conversationAppId: string | null;
  clearConversationState: () => void;
}

export function useChatConversationState(
  currentPathname: string | null
): UseChatConversationStateReturn {
  const [difyConversationId, setDifyConversationId] = useState<string | null>(
    null
  );
  const [dbConversationUUID, setDbConversationUUID] = useState<string | null>(
    null
  );
  const [conversationAppId, setConversationAppId] = useState<string | null>(
    null
  );

  useEffect(() => {
    void syncChatRouteState({
      currentPathname,
      setDifyConversationId,
      setDbConversationUUID,
      setConversationAppId,
    });
  }, [currentPathname]);

  const clearConversationState = useCallback(() => {
    console.log('[useChatInterface] Clear conversation state');
    setDifyConversationId(null);
    setDbConversationUUID(null);
    setConversationAppId(null);
  }, []);

  return {
    difyConversationId,
    setDifyConversationId,
    dbConversationUUID,
    setDbConversationUUID,
    conversationAppId,
    clearConversationState,
  };
}
