/** @jest-environment node */
import {
  getDisplayConversations,
  getMoreActionsOpacityClass,
  getPendingChats,
  getSavedRecentItems,
  getUnpinnedChats,
  isPendingConversationLoading,
  isRecentTaskExecution,
  shouldUseTypewriter,
} from '@components/sidebar/sidebar-chat-list/helpers';

describe('sidebar chat list helpers', () => {
  const conversation = {
    id: 'c1',
    updated_at: '2026-03-25T00:00:00Z',
    isPending: false,
  } as never;
  const pendingConversation = {
    id: 'c2',
    updated_at: '2026-03-26T00:00:00Z',
    isPending: true,
    pendingStatus: 'creating',
    titleTypewriterState: {
      shouldStartTyping: true,
      targetTitle: 'Typing title',
    },
  } as never;
  const execution = {
    id: 'e1',
    kind: 'execution',
    updated_at: '2026-03-27T00:00:00Z',
  } as never;

  it('classifies items and pending state', () => {
    expect(isRecentTaskExecution(execution)).toBe(true);
    expect(isRecentTaskExecution(conversation)).toBe(false);
    expect(isPendingConversationLoading(pendingConversation)).toBe(true);
    expect(shouldUseTypewriter(pendingConversation)).toBe('Typing title');
  });

  it('builds display and filtered lists', () => {
    expect(getDisplayConversations(true, [], [conversation])).toEqual([
      conversation,
    ]);
    expect(getPendingChats([conversation, pendingConversation])).toEqual([
      pendingConversation,
    ]);
    expect(getUnpinnedChats([conversation, pendingConversation])).toEqual([
      conversation,
    ]);
  });

  it('sorts recent items and calculates opacity classes', () => {
    expect(getSavedRecentItems([conversation], [execution])[0]).toBe(execution);
    expect(getMoreActionsOpacityClass(null, 'a', false)).toBe(
      'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
    );
    expect(getMoreActionsOpacityClass('a', 'a', false)).toBe('opacity-100');
    expect(getMoreActionsOpacityClass('b', 'a', false)).toBe('opacity-0');
    expect(getMoreActionsOpacityClass(null, 'a', true)).toBe(
      'pointer-events-none'
    );
  });
});
