import { useCallback, useEffect, useRef, useState } from 'react';

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
  const version = useRef(0);

  useEffect(() => {
    const current = ++version.current;
    const apply =
      (setter: (value: string | null) => void) => (value: string | null) => {
        if (version.current === current) setter(value);
      };
    void Promise.resolve().then(() => {
      if (version.current !== current) return;
      setDbConversationUUID(null);
      setConversationAppId(null);
      return syncChatRouteState({
        currentPathname,
        setDifyConversationId: apply(setDifyConversationId),
        setDbConversationUUID: apply(setDbConversationUUID),
        setConversationAppId: apply(setConversationAppId),
      });
    });
    return () => {
      version.current += 1;
    };
  }, [currentPathname]);

  const clearConversationState = useCallback(() => {
    version.current += 1;
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
