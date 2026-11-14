import { useChatInputStore } from './chat-input-store';

describe('scoped chat input drafts', () => {
  beforeEach(() => {
    useChatInputStore.getState().clearAllMessages();
    useChatInputStore.getState().setCurrentRoute('A');
  });

  it('keeps legacy text access isolated by explicit scope', () => {
    const input = useChatInputStore.getState();
    input.setMessage('draft A');
    input.setCurrentRoute('B');
    expect(useChatInputStore.getState().message).toBe('');
    input.setMessage('draft B');
    input.setCurrentRoute('A');
    expect(input.getMessage()).toBe('draft A');
  });

  it('consumes only the submitted revision, even after edits return to identical text', () => {
    const input = useChatInputStore.getState();
    input.setMessage('first');
    const snapshot = input.snapshot();
    input.setMessage('second');
    input.setMessage('first');
    input.consumeSnapshot(snapshot);
    expect(input.getMessage()).toBe('first');
    input.consumeSnapshot(input.snapshot());
    expect(input.getMessage()).toBe('');
  });

  it('clears the original bucket, not a subsequently selected draft', () => {
    const input = useChatInputStore.getState();
    input.setMessage('sent');
    const snapshot = input.snapshot();
    input.setCurrentRoute('B');
    input.setMessage('new');
    input.consumeSnapshot(snapshot);
    expect(input.getMessage()).toBe('new');
    expect(useChatInputStore.getState().messagesByRoute.A).toBeUndefined();
  });

  it('moves unsent edits to a conversation and lets the old snapshot resolve its alias', () => {
    const input = useChatInputStore.getState();
    input.setMessage('submitted');
    const snapshot = input.snapshot();
    input.setMessage('unsent edit');
    input.setCurrentRoute('conversation');
    expect(input.migrateScope('A', 'conversation')).toBe(true);
    input.consumeSnapshot(snapshot);
    expect(input.getMessage()).toBe('unsent edit');
    input.setCurrentRoute('A');
    expect(useChatInputStore.getState().currentRoute).toBe('conversation');
  });

  it('does not overwrite a destination draft or retain an earlier actor', () => {
    const input = useChatInputStore.getState();
    input.setActor('first-user');
    input.setCurrentRoute('A');
    input.setMessage('source');
    input.setCurrentRoute('B');
    input.setMessage('destination');
    expect(input.migrateScope('A', 'B')).toBe(false);
    input.setActor('second-user');
    expect(useChatInputStore.getState().messagesByRoute).toEqual({});
    expect(input.getMessage()).toBe('');
  });
});
