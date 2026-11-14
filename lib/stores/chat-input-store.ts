import { create } from 'zustand';

export interface DraftSnapshot {
  scope: string;
  revision: number;
  message: string;
}

interface ChatInputState {
  messagesByRoute: Record<string, string>;
  revisionsByRoute: Record<string, number>;
  aliases: Record<string, string>;
  currentRoute: string;
  actorId: string | null;
  actorEpoch: number;
  message: string;
  getMessage: () => string;
  setMessage: (message: string) => void;
  clearMessage: () => void;
  setCurrentRoute: (route: string) => void;
  clearAllMessages: () => void;
  clearRouteMessage: (route: string) => void;
  setActor: (actorId: string | null) => boolean;
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
  messagesByRoute: {},
  revisionsByRoute: {},
  aliases: {},
  currentRoute: 'default',
  actorId: null,
  actorEpoch: 0,
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
    set({
      message,
      messagesByRoute: { ...state.messagesByRoute, [scope]: message },
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
    set({
      currentRoute: scope,
      message: get().messagesByRoute[scope] || '',
      isComposing: false,
    });
  },
  clearAllMessages: () =>
    set({
      messagesByRoute: {},
      revisionsByRoute: {},
      aliases: {},
      message: '',
    }),
  clearRouteMessage: route => {
    const scope = get().resolveScope(route);
    set(state => {
      const messagesByRoute = { ...state.messagesByRoute };
      delete messagesByRoute[scope];
      return {
        messagesByRoute,
        revisionsByRoute: {
          ...state.revisionsByRoute,
          [scope]: (state.revisionsByRoute[scope] || 0) + 1,
        },
        message: scope === state.currentRoute ? '' : state.message,
      };
    });
  },
  setActor: actorId => {
    if (get().actorId === actorId) return false;
    set(state => ({
      actorId,
      actorEpoch: state.actorEpoch + 1,
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
    if (state.messagesByRoute[target]) return false;
    const messagesByRoute = { ...state.messagesByRoute };
    messagesByRoute[target] = messagesByRoute[source] || '';
    delete messagesByRoute[source];
    set({
      messagesByRoute,
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
