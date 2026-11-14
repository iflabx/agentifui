import { getConversationByExternalId } from '@lib/services/client/conversations-api';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import { syncChatDraftActor } from '@lib/stores/chat-draft-lifecycle';
import {
  acceptedDrafts,
  appDrafts,
  chatInputNavigation,
  pendingDrafts,
} from '@lib/stores/chat-input-scope-cache';
import {
  chatInputScope,
  useChatInputStore,
} from '@lib/stores/chat-input-store';
import { usePendingConversationStore } from '@lib/stores/pending-conversation-store';

import { useLayoutEffect, useRef, useState } from 'react';

import { usePathname } from 'next/navigation';

function migrateDraft(source: string, target: string) {
  const input = useChatInputStore.getState();
  const attachments = useAttachmentStore.getState();
  if (input.resolveScope(source) === input.resolveScope(target)) return;
  if (input.messagesByRoute[target] || attachments.getFiles(target).length)
    return;
  if (input.migrateScope(source, target))
    attachments.migrateScope(source, target);
}

export function registerChatInputSubmission(scope: string) {
  pendingDrafts.add(scope);
  return () => pendingDrafts.delete(scope);
}

export async function bindChatInputConversation(
  scope: string,
  userId: string,
  appId: string,
  externalId: string
) {
  const actorEpoch = useChatInputStore.getState().actorEpoch;
  const prefix = JSON.stringify([actorEpoch, userId, appId]).slice(0, -1) + ',';
  if (!scope.startsWith(prefix)) return;
  acceptedDrafts.set(
    JSON.stringify([actorEpoch, userId, appId, externalId]),
    scope
  );
  const result = await getConversationByExternalId(externalId);
  const input = useChatInputStore.getState();
  if (
    !result.success ||
    !result.data ||
    result.data.user_id !== userId ||
    result.data.app_id !== appId ||
    input.actorId !== userId ||
    input.actorEpoch !== actorEpoch ||
    !scope.startsWith(
      JSON.stringify([actorEpoch, userId, appId]).slice(0, -1) + ','
    )
  )
    return;
  const target = chatInputScope(
    actorEpoch,
    userId,
    appId,
    `conversation:${result.data.id}`
  );
  migrateDraft(scope, target);
}

interface InputContext {
  userId?: string;
  appId?: string | null;
  authLoading?: boolean;
}

export function useChatInputRouteSync({
  userId,
  appId,
  authLoading = false,
}: InputContext = {}) {
  const pathname = usePathname() ?? '';
  const externalRouteId = pathname.match(/^\/chat\/([^/]+)$/)?.[1];
  const persistedId = usePendingConversationStore(
    state =>
      Array.from(state.pendingConversations.values()).find(
        item => item.realId === externalRouteId
      )?.db_pk
  );
  const [resolved, setResolved] = useState<{
    route: string;
    userId: string;
    requestedApp: string;
    appId: string;
    scope: string;
  } | null>(null);
  const previous = useRef<{
    appId: string;
    userId: string;
    scope: string;
  } | null>(null);
  const generation = useRef(0);

  useLayoutEffect(() => {
    const version = ++generation.current;
    if (authLoading) return;
    const input = useChatInputStore.getState();
    if (input.actorId !== (userId || null)) {
      syncChatDraftActor(userId || null);
      previous.current = null;
    }
    if (!userId || !appId) return;
    const enteredNewChat =
      pathname === '/chat/new' &&
      chatInputNavigation.activePathname !== null &&
      chatInputNavigation.activePathname !== pathname;
    chatInputNavigation.activePathname = pathname;
    const actorEpoch = useChatInputStore.getState().actorEpoch;
    const activate = (
      resolvedApp: string,
      target: string,
      externalId?: string
    ) => {
      if (
        version !== generation.current ||
        useChatInputStore.getState().actorEpoch !== actorEpoch ||
        useChatInputStore.getState().actorId !== userId
      )
        return;
      const scope = chatInputScope(actorEpoch, userId, resolvedApp, target);
      const source =
        externalId &&
        acceptedDrafts.get(
          JSON.stringify([actorEpoch, userId, resolvedApp, externalId])
        );
      if (source) migrateDraft(source, scope);
      useChatInputStore.getState().setCurrentRoute(scope);
      useAttachmentStore.getState().setScope(scope);
      previous.current = { appId: resolvedApp, userId, scope };
      setResolved({
        route: pathname,
        userId,
        requestedApp: appId,
        appId: resolvedApp,
        scope,
      });
    };
    const externalId = pathname.match(/^\/chat\/([^/]+)$/)?.[1];
    if (
      externalId &&
      externalId !== 'new' &&
      !externalId.startsWith('temp-') &&
      externalId !== 'history'
    ) {
      void getConversationByExternalId(decodeURIComponent(externalId))
        .then(result => {
          if (
            result.success &&
            result.data?.app_id &&
            result.data.user_id === userId
          )
            activate(
              result.data.app_id,
              `conversation:${result.data.id}`,
              decodeURIComponent(externalId)
            );
        })
        .catch(() => undefined);
    } else {
      const routeApp = pathname.match(
        /^\/apps\/(?:chatbot|chatflow)\/([^/]+)$/
      )?.[1];
      const resolvedApp = routeApp ? decodeURIComponent(routeApp) : appId;
      const prior = previous.current;
      if (
        prior &&
        prior.userId === userId &&
        prior.appId === resolvedApp &&
        externalId?.startsWith('temp-') &&
        pendingDrafts.has(prior.scope)
      ) {
        useChatInputStore.getState().setCurrentRoute(prior.scope);
        useAttachmentStore.getState().setScope(prior.scope);
        setResolved({
          route: pathname,
          userId,
          requestedApp: appId,
          appId: resolvedApp,
          scope: prior.scope,
        });
      } else {
        const key = JSON.stringify([actorEpoch, userId, resolvedApp, pathname]);
        const saved = enteredNewChat ? undefined : appDrafts.get(key);
        const existing =
          saved &&
          useChatInputStore
            .getState()
            .resolveScope(
              chatInputScope(actorEpoch, userId, resolvedApp, saved)
            ) === chatInputScope(actorEpoch, userId, resolvedApp, saved)
            ? saved
            : undefined;
        const target = existing || `newdraft:${crypto.randomUUID()}`;
        appDrafts.set(key, target);
        activate(resolvedApp, target);
      }
    }
    return () => {
      generation.current += 1;
    };
  }, [pathname, userId, appId, authLoading, persistedId]);

  const ready = Boolean(
    !authLoading &&
    resolved &&
    resolved.route === pathname &&
    resolved.userId === userId &&
    resolved.requestedApp === appId
  );
  return {
    ready,
    scope: ready ? resolved!.scope : null,
    appId: ready ? resolved!.appId : null,
  };
}
