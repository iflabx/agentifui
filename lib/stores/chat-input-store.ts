import { create } from 'zustand';

import type { MessageEditSource } from '../../packages/shared/src/message-edit';
import {
  readComposerDraft,
  scopedComposerDraftKey,
  writeComposerDraft,
} from './chat-draft-session';

export interface DraftSnapshot {
  editSource?: MessageEditSource;
  scope: string;
  revision: number;
  message: string;
}

interface ChatInputState {
  acceptedScopes: Record<string, boolean>;
  markAccepted: (scope: string) => void;
  editSources: Record<string, MessageEditSource | undefined>;
  setEditSource: (source?: MessageEditSource) => void;
  messagesByRoute: Record<string, string>;
  revisionsByRoute: Record<string, number>;
  aliases: Record<string, string>;
  currentRoute: string;
  actorId: string | null;
  actorEpoch: number;
  actorSessionId: string | null;
  message: string;
  getMessage: () => string;
  setMessage: (message: string) => void;
  clearMessage: () => void;
  setCurrentRoute: (route: string) => void;
  clearAllMessages: () => void;
  clearRouteMessage: (route: string) => void;
  setActor: (actorId: string | null, sessionId?: string | null) => boolean;
  snapshot: () => DraftSnapshot;
  consumeSnapshot: (snapshot: DraftSnapshot) => void;
  migrateScope: (source: string, target: string) => boolean;
  resolveScope: (scope: string) => string;
  isComposing: boolean;
  setIsComposing: (value: boolean) => void;
  isWelcomeScreen: boolean;
  setIsWelcomeScreen: (value: boolean) => void;
  isDark: boolean;
  toggleDarkMode: () => void;
  setDarkMode: (value: boolean) => void;
}

export function chatInputScope(
  epoch: number,
  actor: string,
  app: string,
  target: string
) {
  return JSON.stringify([epoch, actor, app, target]);
}

export const useChatInputStore = create<ChatInputState>((set, get) => ({
  acceptedScopes: {},
  markAccepted: scope =>
    set(state => ({
      acceptedScopes: {
        ...state.acceptedScopes,
        [state.resolveScope(scope)]: true,
      },
    })),
  editSources: {},
  setEditSource: source =>
    set(state => ({
      editSources: { ...state.editSources, [state.currentRoute]: source },
      revisionsByRoute: {
        ...state.revisionsByRoute,
        [state.currentRoute]:
          (state.revisionsByRoute[state.currentRoute] || 0) + 1,
      },
    })),
  messagesByRoute: {},
  revisionsByRoute: {},
  aliases: {},
  currentRoute: 'default',
  actorId: null,
  actorEpoch: 0,
  actorSessionId: null,
  message: '',
  resolveScope: scope => {
    let resolved = scope;
    while (get().aliases[resolved]) resolved = get().aliases[resolved];
    return resolved;
  },
  getMessage: () => get().message,
  setMessage: message => {
    const state = get();
    const scope = state.currentRoute;
    if (state.message === message) return;
    writeComposerDraft(
      scopedComposerDraftKey('chat-text', scope, state),
      message || undefined
    );
    set({
      message,
      messagesByRoute: { ...state.messagesByRoute, [scope]: message },
      ...(message
        ? {}
        : { editSources: { ...state.editSources, [scope]: undefined } }),
      revisionsByRoute: {
        ...state.revisionsByRoute,
        [scope]: (state.revisionsByRoute[scope] || 0) + 1,
      },
    });
  },
  clearMessage: () => get().setMessage(''),
  setCurrentRoute: route => {
    const scope = get().resolveScope(route);
    if (scope === get().currentRoute) return;
    const state = get();
    const stored = readComposerDraft(
      scopedComposerDraftKey('chat-text', scope, state)
    );
    const message =
      state.messagesByRoute[scope] ??
      (typeof stored === 'string' ? stored : '');
    set({
      currentRoute: scope,
      message,
      messagesByRoute: { ...state.messagesByRoute, [scope]: message },
      isComposing: false,
    });
  },
  clearAllMessages: () =>
    set({
      acceptedScopes: {},
      editSources: {},
      messagesByRoute: {},
      revisionsByRoute: {},
      aliases: {},
      message: '',
    }),
  clearRouteMessage: route => {
    const scope = get().resolveScope(route);
    writeComposerDraft(
      scopedComposerDraftKey('chat-text', scope, get()),
      undefined
    );
    set(state => {
      const messagesByRoute = { ...state.messagesByRoute };
      delete messagesByRoute[scope];
      return {
        messagesByRoute,
        editSources: { ...state.editSources, [scope]: undefined },
        revisionsByRoute: {
          ...state.revisionsByRoute,
          [scope]: (state.revisionsByRoute[scope] || 0) + 1,
        },
        message: scope === state.currentRoute ? '' : state.message,
      };
    });
  },
  setActor: (actorId, sessionId) => {
    const current = get();
    const sessionChanged =
      sessionId !== undefined &&
      current.actorSessionId !== null &&
      current.actorSessionId !== sessionId;
    if (current.actorId === actorId && !sessionChanged) {
      if (sessionId !== undefined && current.actorSessionId !== sessionId)
        set({ actorSessionId: sessionId });
      return false;
    }
    set(state => ({
      actorId,
      actorSessionId: sessionId ?? null,
      actorEpoch: state.actorEpoch + 1,
      acceptedScopes: {},
      editSources: {},
      messagesByRoute: {},
      revisionsByRoute: {},
      aliases: {},
      message: '',
      currentRoute: 'default',
      isComposing: false,
    }));
    return true;
  },
  snapshot: () => ({
    scope: get().currentRoute,
    revision: get().revisionsByRoute[get().currentRoute] || 0,
    message: get().message,
    ...(get().editSources[get().currentRoute]
      ? { editSource: get().editSources[get().currentRoute] }
      : {}),
  }),
  consumeSnapshot: snapshot => {
    const state = get();
    const scope = state.resolveScope(snapshot.scope);
    if (
      state.messagesByRoute[scope] !== snapshot.message ||
      (state.revisionsByRoute[scope] || 0) !== snapshot.revision
    )
      return;
    state.clearRouteMessage(scope);
  },
  migrateScope: (source, target) => {
    const state = get();
    source = state.resolveScope(source);
    target = state.resolveScope(target);
    if (source === target) return true;
    const targetKey = scopedComposerDraftKey('chat-text', target, state);
    if (state.messagesByRoute[target] || readComposerDraft(targetKey))
      return false;
    const messagesByRoute = { ...state.messagesByRoute };
    messagesByRoute[target] = messagesByRoute[source] || '';
    delete messagesByRoute[source];
    writeComposerDraft(targetKey, messagesByRoute[target] || undefined);
    writeComposerDraft(
      scopedComposerDraftKey('chat-text', source, state),
      undefined
    );
    set({
      messagesByRoute,
      acceptedScopes: {
        ...state.acceptedScopes,
        [target]: Boolean(
          state.acceptedScopes[source] || state.acceptedScopes[target]
        ),
      },
      editSources: {
        ...state.editSources,
        [source]: undefined,
        [target]: state.editSources[source],
      },
      revisionsByRoute: {
        ...state.revisionsByRoute,
        [target]: state.revisionsByRoute[source] || 0,
      },
      aliases: { ...state.aliases, [source]: target },
      currentRoute: state.currentRoute === source ? target : state.currentRoute,
      message:
        state.currentRoute === target ? messagesByRoute[target] : state.message,
    });
    return true;
  },
  isComposing: false,
  setIsComposing: isComposing => set({ isComposing }),
  isWelcomeScreen: true,
  setIsWelcomeScreen: isWelcomeScreen => set({ isWelcomeScreen }),
  isDark: false,
  toggleDarkMode: () => set(state => ({ isDark: !state.isDark })),
  setDarkMode: isDark => set({ isDark }),
}));
