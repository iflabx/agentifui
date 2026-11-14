import { create } from 'zustand';

export interface LangchainDraftSnapshot {
  scope: string;
  text: string;
  revision: number;
}

interface LangchainDraftState {
  actorId: string | null;
  actorEpoch: number;
  drafts: Record<string, LangchainDraftSnapshot>;
  activeNewScopes: Record<string, string>;
  conversationScopes: Record<string, string>;
  setActor: (actorId: string | null) => void;
  selectScope: (appId: string, target: string, fresh: boolean) => string | null;
  bindConversation: (
    scope: string,
    appId: string,
    conversationId: string
  ) => void;
  setText: (scope: string, text: string) => void;
  consumeSnapshot: (snapshot: LangchainDraftSnapshot) => void;
}

export function langchainDraftScope(
  epoch: number,
  actor: string,
  app: string,
  target: string
) {
  return JSON.stringify([epoch, actor, app, target]);
}

export const useLangchainDraftStore = create<LangchainDraftState>(
  (set, get) => ({
    actorId: null,
    actorEpoch: 0,
    drafts: {},
    activeNewScopes: {},
    conversationScopes: {},
    setActor: actorId => {
      if (get().actorId === actorId) return;
      set(state => ({
        actorId,
        actorEpoch: state.actorEpoch + 1,
        drafts: {},
        activeNewScopes: {},
        conversationScopes: {},
      }));
    },
    selectScope: (appId, target, fresh) => {
      const state = get();
      if (!state.actorId) return null;
      const scope = langchainDraftScope(
        state.actorEpoch,
        state.actorId,
        appId,
        target
      );
      if (!target.startsWith('new:'))
        return state.conversationScopes[scope] || scope;
      const key = JSON.stringify([state.actorEpoch, state.actorId, appId]);
      if (!fresh && state.activeNewScopes[key])
        return state.activeNewScopes[key];
      const newScope = langchainDraftScope(
        state.actorEpoch,
        state.actorId,
        appId,
        `new:${crypto.randomUUID()}`
      );
      set({ activeNewScopes: { ...state.activeNewScopes, [key]: newScope } });
      return newScope;
    },
    bindConversation: (scope, appId, conversationId) => {
      const state = get();
      if (!state.actorId) return;
      const key = JSON.stringify([state.actorEpoch, state.actorId, appId]);
      if (!scope.startsWith(key.slice(0, -1) + ',')) return;
      const target = langchainDraftScope(
        state.actorEpoch,
        state.actorId,
        appId,
        conversationId
      );
      if (state.conversationScopes[target] === scope) return;
      const activeNewScopes = { ...state.activeNewScopes };
      if (activeNewScopes[key] === scope) delete activeNewScopes[key];
      set({
        activeNewScopes,
        conversationScopes: { ...state.conversationScopes, [target]: scope },
      });
    },
    setText: (scope, text) => {
      const state = get();
      const prefix =
        JSON.stringify([state.actorEpoch, state.actorId]).slice(0, -1) + ',';
      if (!state.actorId || !scope.startsWith(prefix)) return;
      set({
        drafts: {
          ...state.drafts,
          [scope]: {
            scope,
            text,
            revision: (state.drafts[scope]?.revision || 0) + 1,
          },
        },
      });
    },
    consumeSnapshot: snapshot => {
      const current = get().drafts[snapshot.scope];
      if (
        !current ||
        current.revision !== snapshot.revision ||
        current.text !== snapshot.text
      )
        return;
      get().setText(snapshot.scope, '');
    },
  })
);
