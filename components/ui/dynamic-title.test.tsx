import { useCombinedConversations } from '@lib/hooks/use-combined-conversations';
import { syncChatDraftActor } from '@lib/stores/chat-draft-lifecycle';
import { act, render } from '@testing-library/react';

import { DynamicTitle } from './dynamic-title';

jest.mock('@lib/hooks/use-combined-conversations', () => ({
  useCombinedConversations: jest.fn(),
}));
jest.mock('@lib/stores/app-list-store', () => ({
  useAppListStore: () => ({ apps: [], isLoading: false }),
}));
jest.mock('@lib/stores/chat-store', () => ({
  useChatStore: () => 'same-conversation',
}));
jest.mock('next/navigation', () => ({
  usePathname: () => '/chat/same-conversation',
}));

beforeEach(() => {
  jest.useFakeTimers();
  syncChatDraftActor(null);
  syncChatDraftActor('first');
  jest.mocked(useCombinedConversations).mockReturnValue({
    conversations: [{ id: 'same-conversation', title: 'Private first title' }],
    isLoading: false,
  } as ReturnType<typeof useCombinedConversations>);
});
afterEach(() => jest.useRealTimers());

it.each([false, true])(
  'clears cached titles and old timers on switch (already rendered: %s)',
  rendered => {
    render(<DynamicTitle />);
    if (rendered) {
      act(() => jest.advanceTimersByTime(60));
      expect(document.title).toContain('Private first title');
    }
    jest.mocked(useCombinedConversations).mockReturnValue({
      conversations: [],
      isLoading: true,
    } as unknown as ReturnType<typeof useCombinedConversations>);
    act(() => syncChatDraftActor('second'));
    expect(document.title).toBe(
      process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || 'dynamicTitle.base'
    );
    act(() => jest.runOnlyPendingTimers());
    expect(document.title).not.toContain('Private first title');
  }
);
