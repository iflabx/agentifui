import { create } from 'zustand';

import type { MessageEditSource } from '../../packages/shared/src/message-edit';
import { type AttachmentFile, useAttachmentStore } from './attachment-store';
import {
  composerDraftKey,
  parseDraftScope,
  readComposerDraft,
  scopedComposerDraftKey,
  writeComposerDraft,
} from './chat-draft-session';
import { useChatInputStore } from './chat-input-store';

export interface LangchainDraftSnapshot {
  editSource?: MessageEditSource;
  scope: string;
  text: string;
  revision: number;
}

export interface PendingAgentSubmission {
  editSourceId?: string;
  appId: string;
  target: string;
  submissionId: string;
  content: string;
  snapshot?: LangchainDraftSnapshot;
  fileDrafts?: { scope: string; files: AttachmentFile[] }[];
  inputFiles?: { id: string; name: string; size: number; type: string }[];
}

interface LangchainDraftState {
  actorId: string | null;
  actorEpoch: number;
  drafts: Record<string, LangchainDraftSnapshot>;
  activeNewScopes: Record<string, string>;
  conversationScopes: Record<string, string>;
  pendingSubmissions: Record<string, PendingAgentSubmission>;
  rememberSubmission: (
    actorId: string,
    pending: PendingAgentSubmission
  ) => void;
  findSubmission: (
    actorId: string,
    appId: string,
    target: string
  ) => PendingAgentSubmission | undefined;
  forgetSubmission: (
    actorId: string,
    submissionId: string,
    accepted?: boolean
  ) => void;
  setActor: (actorId: string | null, reset?: boolean) => void;
  selectScope: (appId: string, target: string, fresh: boolean) => string | null;
  bindConversation: (
    scope: string,
    appId: string,
    conversationId: string
  ) => void;
  setText: (scope: string, text: string) => void;
  setEditSource: (scope: string, source?: MessageEditSource) => void;
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

function agentTextKey(scope: string, state: LangchainDraftState) {
  return scopedComposerDraftKey('agent-text', scope, {
    ...state,
    actorSessionId: useChatInputStore.getState().actorSessionId,
  });
}

export const useLangchainDraftStore = create<LangchainDraftState>(
  (set, get) => ({
    actorId: null,
    actorEpoch: 0,
    drafts: {},
    activeNewScopes: {},
    conversationScopes: {},
    pendingSubmissions: {},
    rememberSubmission: (actorId, pending) => {
      if (get().actorId !== actorId) return;
      set(state => ({
        pendingSubmissions: {
          ...state.pendingSubmissions,
          [JSON.stringify([pending.appId, pending.target])]: pending,
        },
      }));
    },
    findSubmission: (actorId, appId, target) =>
      get().actorId === actorId
        ? get().pendingSubmissions[JSON.stringify([appId, target])]
        : undefined,
    forgetSubmission: (actorId, submissionId, accepted = false) => {
      const state = get();
      if (state.actorId !== actorId) return;
      const pending = Object.values(state.pendingSubmissions).find(
        item => item.submissionId === submissionId
      );
      if (!pending) return;
      if (accepted && pending.snapshot) state.consumeSnapshot(pending.snapshot);
      if (accepted)
        for (const entry of pending.fileDrafts ?? [])
          useAttachmentStore.getState().consumeFiles(entry.scope, entry.files);
      const next = { ...get().pendingSubmissions };
      delete next[JSON.stringify([pending.appId, pending.target])];
      set({ pendingSubmissions: next });
    },
    setActor: (actorId, reset = false) => {
      if (get().actorId === actorId && !reset) return;
      set(state => ({
        actorId,
        actorEpoch: state.actorEpoch + 1,
        drafts: {},
        activeNewScopes: {},
        conversationScopes: {},
        pendingSubmissions: {},
      }));
    },
    selectScope: (appId, target, fresh) => {
      const state = get();
      if (!state.actorId) return null;
      const actorId = state.actorId;
      const sessionId = useChatInputStore.getState().actorSessionId;
      const scope = langchainDraftScope(
        state.actorEpoch,
        actorId,
        appId,
        target
      );
      const newSession = target.startsWith('new:');
      const saved = readComposerDraft(
        composerDraftKey(
          actorId,
          sessionId,
          newSession ? 'agent-new' : 'agent-conversation',
          appId,
          newSession ? null : target
        )
      );
      const remembered =
        typeof saved === 'string' && saved.startsWith('new:')
          ? langchainDraftScope(state.actorEpoch, actorId, appId, saved)
          : undefined;
      const key = JSON.stringify([state.actorEpoch, actorId, appId]);
      let selected = state.conversationScopes[scope] || remembered || scope;
      if (newSession) {
        selected =
          (!fresh && (state.activeNewScopes[key] || remembered)) ||
          langchainDraftScope(
            state.actorEpoch,
            actorId,
            appId,
            `new:${crypto.randomUUID()}`
          );
        writeComposerDraft(
          composerDraftKey(actorId, sessionId, 'agent-new', appId, null),
          parseDraftScope(selected)[3]
        );
        set({ activeNewScopes: { ...state.activeNewScopes, [key]: selected } });
      }
      if (!get().drafts[selected]) {
        const text = readComposerDraft(agentTextKey(selected, state));
        if (typeof text === 'string' && text)
          set(current => ({
            drafts: {
              ...current.drafts,
              [selected]: { scope: selected, text, revision: 0 },
            },
          }));
      }
      return selected;
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
      const sessionId = useChatInputStore.getState().actorSessionId;
      if (activeNewScopes[key] === scope) {
        delete activeNewScopes[key];
        writeComposerDraft(
          composerDraftKey(state.actorId, sessionId, 'agent-new', appId, null),
          undefined
        );
      }
      writeComposerDraft(
        composerDraftKey(
          state.actorId,
          sessionId,
          'agent-conversation',
          appId,
          conversationId
        ),
        parseDraftScope(scope)[3]
      );
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
      writeComposerDraft(agentTextKey(scope, state), text || undefined);
      set({
        drafts: {
          ...state.drafts,
          [scope]: {
            scope,
            text,
            revision: (state.drafts[scope]?.revision || 0) + 1,
            ...(text && state.drafts[scope]?.editSource
              ? { editSource: state.drafts[scope].editSource }
              : {}),
          },
        },
      });
    },
    setEditSource: (scope, editSource) => {
      const state = get();
      const prefix =
        JSON.stringify([state.actorEpoch, state.actorId]).slice(0, -1) + ',';
      if (!state.actorId || !scope.startsWith(prefix)) return;
      const current = state.drafts[scope];
      if (!current) return;
      set({
        drafts: {
          ...state.drafts,
          [scope]: { ...current, editSource, revision: current.revision + 1 },
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
