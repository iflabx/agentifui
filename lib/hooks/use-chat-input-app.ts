import { useChatInputStore } from '@lib/stores/chat-input-store';
import {
  fetchActiveAppInstance,
  useCurrentAppStore,
} from '@lib/stores/current-app-store';
import type { ServiceInstance } from '@lib/types/database';

import { useCallback, useEffect, useState } from 'react';

export function useChatInputApp(appId: string | null, ready: boolean) {
  const { currentAppId, currentAppInstance } = useCurrentAppStore();
  const actorEpoch = useChatInputStore(state => state.actorEpoch);
  const [resolved, setResolved] = useState<{
    appId: string;
    actorEpoch: number;
    instance: ServiceInstance | null;
    failed?: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const selected =
    ready && appId === currentAppId && currentAppInstance?.instance_id === appId
      ? currentAppInstance
      : null;
  useEffect(() => {
    if (!ready || !appId || selected) return;
    let active = true;
    const failed = () => {
      if (active && useChatInputStore.getState().actorEpoch === actorEpoch)
        setResolved({ appId, actorEpoch, instance: null, failed: true });
    };
    void fetchActiveAppInstance(appId)
      .then(instance => {
        if (
          active &&
          instance?.instance_id === appId &&
          useChatInputStore.getState().actorEpoch === actorEpoch
        )
          setResolved({ appId, actorEpoch, instance });
        else if (!instance || instance.instance_id !== appId) failed();
      })
      .catch(failed);
    return () => {
      active = false;
    };
  }, [appId, ready, selected, actorEpoch, attempt]);
  const retry = useCallback(() => {
    setResolved(null);
    setAttempt(value => value + 1);
  }, []);
  const instance =
    selected ||
    (ready && resolved?.appId === appId && resolved.actorEpoch === actorEpoch
      ? resolved.instance
      : null);
  return {
    instance,
    failed: Boolean(
      ready &&
      !instance &&
      resolved?.appId === appId &&
      resolved.actorEpoch === actorEpoch &&
      resolved.failed
    ),
    retry,
  };
}
