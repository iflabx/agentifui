import {
  langchainDraftScope,
  useLangchainDraftStore,
} from './langchain-draft-store';

describe('LangChain draft store', () => {
  beforeEach(() => {
    useLangchainDraftStore.getState().setActor(null);
    useLangchainDraftStore.getState().setActor('actor');
  });

  function scope(app: string, target: string) {
    const state = useLangchainDraftStore.getState();
    return langchainDraftScope(state.actorEpoch, 'actor', app, target);
  }

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
