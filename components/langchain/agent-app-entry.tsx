'use client';

import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import type { AppInfo } from '@lib/stores/app-list-store/types';

import { type ReactNode, useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import { AgentChat } from './agent-chat';
import { agentAppPath } from './routing';

export function AgentAppEntry({
  instanceId,
  children,
}: {
  instanceId: string;
  children: ReactNode;
}) {
  const { session, loading } = useAuthSession();
  const actorId = session?.user.id;
  const key = JSON.stringify([actorId, instanceId]);
  const t = useTranslations('langchain');
  const [routing, setRouting] = useState<{
    key: string;
    appId?: string;
    failed?: boolean;
  } | null>(null);
  useEffect(() => {
    if (loading || !actorId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/internal/apps', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('App access unavailable');
        const result = (await response.json()) as {
          success: boolean;
          apps?: AppInfo[];
        };
        const app =
          result.success &&
          result.apps?.find(item => item.instance_id === instanceId);
        if (!app) throw new Error('App unavailable');
        if (!controller.signal.aborted)
          setRouting({
            key,
            ...(agentAppPath(app.id, app.config) ? { appId: app.id } : {}),
          });
      } catch {
        if (!controller.signal.aborted) setRouting({ key, failed: true });
      }
    })();
    return () => controller.abort();
  }, [actorId, instanceId, key, loading]);
  if (!loading && !actorId) return <a href="/login">{t('loginRequired')}</a>;
  if (routing?.key !== key) return <p role="status">{t('loading')}</p>;
  if (routing.failed) return <p role="alert">{t('unavailable')}</p>;
  return routing.appId ? (
    <AgentChat
      key={routing.appId}
      appId={routing.appId}
      conversationId={null}
    />
  ) : (
    children
  );
}
