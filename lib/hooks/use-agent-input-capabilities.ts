'use client';

import { useChatInputStore } from '@lib/stores/chat-input-store';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AgentAttachmentSlot,
  AgentInputCapabilities,
} from '../../packages/shared/src/agent-input';

export function useRetainedInputCapabilities(
  capabilities: AgentInputCapabilities | null
) {
  const [retained, setRetained] = useState<{
    source: AgentInputCapabilities | null;
    value: AgentInputCapabilities | null;
  }>({ source: null, value: null });
  if (capabilities?.status === 'ready' && retained.source !== capabilities) {
    const slots = new Map<string, AgentAttachmentSlot>(
      (retained.value?.attachmentSlots ?? []).map(slot => [
        JSON.stringify([slot.target, slot.key]),
        { ...slot, minCount: 0, maxCount: 0, methods: [] },
      ])
    );
    for (const slot of capabilities.attachmentSlots)
      slots.set(JSON.stringify([slot.target, slot.key]), slot);
    const value = {
      ...capabilities,
      attachmentSlots: [...slots.values()],
    };
    setRetained({ source: capabilities, value });
    return value;
  }
  return retained.value;
}

export function useAgentInputCapabilities(appId: string | null) {
  const actorId = useChatInputStore(state => state.actorId);
  const actorEpoch = useChatInputStore(state => state.actorEpoch);
  const [attempt, setAttempt] = useState(0);
  const identity = useMemo(
    () => ({ appId, actorId, actorEpoch, attempt }),
    [appId, actorId, actorEpoch, attempt]
  );
  const [result, setResult] = useState<{
    identity: typeof identity;
    capabilities: AgentInputCapabilities | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!appId) return;
    const controller = new AbortController();
    let active = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/internal/apps/${encodeURIComponent(appId)}/input-capabilities`,
          { method: 'GET', credentials: 'include', signal: controller.signal }
        );
        if (!response.ok) throw new Error('INPUT_CAPABILITIES_UNAVAILABLE');
        const capabilities = (await response.json()) as AgentInputCapabilities;
        if (
          capabilities.version !== 1 ||
          !['ready', 'unavailable', 'unsupported'].includes(
            capabilities.status
          ) ||
          !Array.isArray(capabilities.attachmentSlots) ||
          !Array.isArray(capabilities.fields) ||
          !capabilities.text
        )
          throw new Error('INPUT_CAPABILITIES_UNSUPPORTED');
        if (active) setResult({ identity, capabilities, error: null });
      } catch {
        if (active)
          setResult({
            identity,
            capabilities: null,
            error: 'INPUT_CAPABILITIES_UNAVAILABLE',
          });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [appId, identity, attempt]);
  const retry = useCallback(() => {
    setResult(null);
    setAttempt(value => value + 1);
  }, []);
  const current = result?.identity === identity ? result : null;
  return {
    capabilities: current?.capabilities ?? null,
    isLoading: Boolean(appId && !current),
    error: current?.error ?? null,
    retry,
  };
}
