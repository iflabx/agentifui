import { getChatflowInitialInputs } from '@lib/services/client/messages-api';
import { useChatInputStore } from '@lib/stores/chat-input-store';

import { useEffect, useState } from 'react';

export function useChatflowInitialInputs(scope: string | null, local: unknown) {
  const actorEpoch = useChatInputStore(state => state.actorEpoch);
  const actorId = useChatInputStore(state => state.actorId);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    value: Record<string, unknown> | null;
    failed?: boolean;
  } | null>(null);
  const target = scope ? (JSON.parse(scope)[3] as string) : '';
  const conversationId = target.startsWith('conversation:')
    ? target.slice('conversation:'.length)
    : null;
  const key = JSON.stringify([scope, actorId, actorEpoch, attempt]);
  const hasLocal = Boolean(
    local && typeof local === 'object' && !Array.isArray(local)
  );
  useEffect(() => {
    if (!conversationId || !actorId || hasLocal) return;
    let active = true;
    void getChatflowInitialInputs(conversationId)
      .then(response => {
        if (active)
          setResult({
            key,
            value: response.success ? response.data : null,
            failed: !response.success,
          });
      })
      .catch(() => {
        if (active) setResult({ key, value: null, failed: true });
      });
    return () => {
      active = false;
    };
  }, [conversationId, actorId, key, hasLocal]);
  const current = result?.key === key ? result : null;
  return {
    value: hasLocal
      ? (local as Record<string, unknown>)
      : (current?.value ?? null),
    loading: !hasLocal && Boolean(conversationId && actorId && !current),
    failed: !hasLocal && Boolean(current?.failed),
    retry: () => setAttempt(value => value + 1),
  };
}
