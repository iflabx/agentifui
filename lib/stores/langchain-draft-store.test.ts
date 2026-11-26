import { useAttachmentStore } from './attachment-store';
import { syncChatDraftActor } from './chat-draft-lifecycle';
import { useChatInputStore } from './chat-input-store';
import {
  langchainDraftScope,
  useLangchainDraftStore,
} from './langchain-draft-store';

describe('LangChain draft store', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useLangchainDraftStore.getState().setActor(null);
    useLangchainDraftStore.getState().setActor('actor');
  });

  it.each(['langchain-app', 'shared-dify-app'])(
    'restores %s text and scoped files across reload and conversation adoption',
    appId => {
      useLangchainDraftStore.setState({ actorId: null, actorEpoch: 0 });
      useChatInputStore.setState({ actorId: null, actorEpoch: 0 });
      syncChatDraftActor('actor', 'session');
      const first = useLangchainDraftStore.getState();
      const original = first.selectScope(appId, 'new:0', false)!;
      first.setText(original, 'Unsent agent question');
      const bucket = (scope: string) =>
        JSON.stringify(['agent-input', scope, 'inputs', 'doc']);
      const fileScope = bucket(original);
      const uploads = useAttachmentStore.getState();
      uploads.addFiles(
        [new File(['synthetic'], 'report.txt', { type: 'text/plain' })],
        fileScope
      );
      const attached = uploads.getFiles(fileScope)[0];
      uploads.finishUpload(
        fileScope,
        attached.id,
        uploads.beginUpload(fileScope, attached.id)!,
        {
          uploadedId: 'upstream-reference',
          appId,
          actorId: 'actor',
          actorEpoch: first.actorEpoch,
        }
      );
      first.bindConversation(original, appId, 'existing-conversation');
      useChatInputStore.getState().setActor(null);
      useLangchainDraftStore.getState().setActor(null);
      useAttachmentStore.getState().resetAll();
      syncChatDraftActor('actor', 'session');
      const reopened = useLangchainDraftStore
        .getState()
        .selectScope(appId, 'existing-conversation', false)!;
      expect(useLangchainDraftStore.getState().drafts[reopened].text).toBe(
        'Unsent agent question'
      );
      uploads.restoreFiles(bucket(reopened));
      expect(uploads.getFiles(bucket(reopened))).toEqual([
        expect.objectContaining({
          name: 'report.txt',
          uploadedId: 'upstream-reference',
          status: 'success',
        }),
      ]);
      const unrelated = useLangchainDraftStore
        .getState()
        .selectScope(appId, 'different-conversation', false)!;
      uploads.restoreFiles(bucket(unrelated));
      expect(
        useLangchainDraftStore.getState().drafts[unrelated]
      ).toBeUndefined();
      expect(uploads.getFiles(bucket(unrelated))).toEqual([]);
      syncChatDraftActor(null);
      expect(sessionStorage.length).toBe(0);
    }
  );

  function scope(app: string, target: string) {
    const state = useLangchainDraftStore.getState();
    return langchainDraftScope(state.actorEpoch, 'actor', app, target);
  }

  it('preserves editing metadata with scoped text until explicitly exited or consumed', () => {
    const key = scope('app', 'conversation');
    const state = useLangchainDraftStore.getState();
    state.setText(key, 'Original');
    state.setEditSource(key, { id: 'source', text: 'Original' });
    state.setText(key, 'Revised');
    const snapshot = useLangchainDraftStore.getState().drafts[key];
    expect(snapshot.editSource?.id).toBe('source');
    state.selectScope('app', 'another', false);
    state.selectScope('app', 'conversation', false);
    expect(useLangchainDraftStore.getState().drafts[key].editSource?.id).toBe(
      'source'
    );
    state.setEditSource(key);
    state.consumeSnapshot(snapshot);
    expect(useLangchainDraftStore.getState().drafts[key].text).toBe('Revised');
    expect(
      useLangchainDraftStore.getState().drafts[key].editSource
    ).toBeUndefined();
    state.setEditSource(key, { id: 'another', text: 'Original' });
    state.consumeSnapshot(useLangchainDraftStore.getState().drafts[key]);
    expect(
      useLangchainDraftStore.getState().drafts[key].editSource
    ).toBeUndefined();
    expect(useLangchainDraftStore.getState().drafts[key].text).toBe('');
  });

  it('keeps actor, application and target buckets distinct', () => {
    const first = scope('app-A', 'new:0');
    const second = scope('app-B', 'new:0');
    const history = scope('app-A', 'conversation');
    useLangchainDraftStore.getState().setText(first, 'A');
    useLangchainDraftStore.getState().setText(second, 'B');
    useLangchainDraftStore.getState().setText(history, 'History');
    expect(useLangchainDraftStore.getState().drafts).toEqual({
      [first]: { scope: first, text: 'A', revision: 1 },
      [second]: { scope: second, text: 'B', revision: 1 },
      [history]: { scope: history, text: 'History', revision: 1 },
    });
  });

  it('consumes only the accepted snapshot and preserves the other application', () => {
    const first = scope('app-A', 'new:0');
    const second = scope('app-B', 'new:0');
    useLangchainDraftStore.getState().setText(first, 'A');
    useLangchainDraftStore.getState().setText(second, 'B');
    const snapshot = useLangchainDraftStore.getState().drafts[first];
    useLangchainDraftStore.getState().consumeSnapshot(snapshot);
    expect(useLangchainDraftStore.getState().drafts[first].text).toBe('');
    expect(useLangchainDraftStore.getState().drafts[second].text).toBe('B');
  });

  it('restores the active new target even when a remounted controller resets its local version', () => {
    const first = useLangchainDraftStore
      .getState()
      .selectScope('app', 'new:0', false)!;
    useLangchainDraftStore.getState().setText(first, 'First');
    const second = useLangchainDraftStore
      .getState()
      .selectScope('app', 'new:1', true)!;
    expect(second).not.toBe(first);
    useLangchainDraftStore.getState().setText(second, 'Latest draft');
    expect(
      useLangchainDraftStore.getState().selectScope('app', 'new:0', false)
    ).toBe(second);
  });

  it('retains the accepted conversation target without reusing it for the next new draft', () => {
    const draft = useLangchainDraftStore
      .getState()
      .selectScope('app', 'new:0', false)!;
    useLangchainDraftStore.getState().setText(draft, 'Unsent follow-up');
    useLangchainDraftStore
      .getState()
      .bindConversation(draft, 'app', 'conversation');
    expect(
      useLangchainDraftStore
        .getState()
        .selectScope('app', 'conversation', false)
    ).toBe(draft);
    const next = useLangchainDraftStore
      .getState()
      .selectScope('app', 'new:0', false)!;
    expect(next).not.toBe(draft);
    expect(useLangchainDraftStore.getState().drafts[next]).toBeUndefined();
    expect(useLangchainDraftStore.getState().drafts[draft].text).toBe(
      'Unsent follow-up'
    );
  });

  it('does not consume a revised draft even when its text matches the submission again', () => {
    const target = scope('app', 'new:0');
    useLangchainDraftStore.getState().setText(target, 'Submitted');
    const snapshot = useLangchainDraftStore.getState().drafts[target];
    useLangchainDraftStore.getState().setText(target, 'Changed');
    useLangchainDraftStore.getState().setText(target, 'Submitted');
    useLangchainDraftStore.getState().consumeSnapshot(snapshot);
    expect(useLangchainDraftStore.getState().drafts[target]).toEqual({
      scope: target,
      text: 'Submitted',
      revision: 3,
    });
  });

  it('clears all buckets on account changes and ignores stale writes and snapshots', () => {
    const oldScope = scope('app', 'new:0');
    useLangchainDraftStore.getState().setText(oldScope, 'Same text');
    const snapshot = useLangchainDraftStore.getState().drafts[oldScope];
    useLangchainDraftStore.getState().setActor('other-actor');
    expect(useLangchainDraftStore.getState().drafts).toEqual({});
    useLangchainDraftStore.getState().setText(oldScope, 'Late write');
    expect(useLangchainDraftStore.getState().drafts).toEqual({});
    useLangchainDraftStore.getState().setActor('actor');
    const newScope = scope('app', 'new:0');
    expect(newScope).not.toBe(oldScope);
    useLangchainDraftStore.getState().setText(newScope, 'Same text');
    useLangchainDraftStore.getState().consumeSnapshot(snapshot);
    expect(useLangchainDraftStore.getState().drafts[newScope].text).toBe(
      'Same text'
    );
    useLangchainDraftStore.getState().setActor(null);
    expect(useLangchainDraftStore.getState().drafts).toEqual({});
  });
});
