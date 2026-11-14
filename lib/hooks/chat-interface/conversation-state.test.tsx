import { act, renderHook, waitFor } from '@testing-library/react';

import { useChatConversationState } from './conversation-state';
import { syncChatRouteState } from './route-sync';

jest.mock('./route-sync', () => ({
  syncChatRouteState: jest.fn(),
}));

describe('useChatConversationState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('syncs state from the current pathname and clears it on demand', async () => {
    (syncChatRouteState as jest.Mock).mockImplementation(
      async ({
        setDifyConversationId,
        setDbConversationUUID,
        setConversationAppId,
      }) => {
        setDifyConversationId('conv-1');
        setDbConversationUUID('db-1');
        setConversationAppId('app-1');
      }
    );

    const { result } = renderHook(() =>
      useChatConversationState('/chat/conv-1')
    );

    await waitFor(() => {
      expect(result.current.difyConversationId).toBe('conv-1');
      expect(result.current.dbConversationUUID).toBe('db-1');
      expect(result.current.conversationAppId).toBe('app-1');
    });

    expect(syncChatRouteState).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPathname: '/chat/conv-1',
        setDifyConversationId: expect.any(Function),
        setDbConversationUUID: expect.any(Function),
        setConversationAppId: expect.any(Function),
      })
    );

    act(() => {
      result.current.clearConversationState();
    });

    expect(result.current.difyConversationId).toBeNull();
    expect(result.current.dbConversationUUID).toBeNull();
    expect(result.current.conversationAppId).toBeNull();
  });

  it('rejects a late route lookup after navigation or explicit reset', async () => {
    const callbacks: Array<Parameters<typeof syncChatRouteState>[0]> = [];
    jest.mocked(syncChatRouteState).mockImplementation(async input => {
      callbacks.push(input);
    });
    const { result, rerender } = renderHook(
      ({ path }) => useChatConversationState(path),
      { initialProps: { path: '/chat/first' } }
    );
    await waitFor(() => expect(callbacks).toHaveLength(1));
    rerender({ path: '/chat/second' });
    await waitFor(() => expect(callbacks).toHaveLength(2));
    act(() => {
      callbacks[1].setDbConversationUUID('second-db');
      callbacks[0].setDbConversationUUID('first-db');
    });
    expect(result.current.dbConversationUUID).toBe('second-db');
    act(() => {
      result.current.clearConversationState();
      callbacks[1].setConversationAppId('late');
    });
    expect(result.current.dbConversationUUID).toBeNull();
    expect(result.current.conversationAppId).toBeNull();
  });
});
