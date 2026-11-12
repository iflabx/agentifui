import { getConversationByExternalId } from '@lib/services/client/conversations-api';
import { getMessagePage } from '@lib/services/client/messages-api';
import { useChatStore } from '@lib/stores/chat-store';
import type { Message } from '@lib/types/database';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useConversationMessages } from './use-conversation-messages';

jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('@lib/services/client/conversations-api', () => ({
  getConversationByExternalId: jest.fn(),
}));
jest.mock('@lib/services/client/messages-api', () => ({
  getMessagePage: jest.fn(),
}));
jest.mock('@lib/stores/chat-scroll-store', () => ({
  useChatScrollStore: { getState: () => ({ resetScrollState: jest.fn() }) },
}));

let mockPathname = '/chat/conversation';
const message = (index: number): Message => ({
  id: `message-${index}`,
  conversation_id: 'database-conversation',
  user_id: null,
  content: String(index),
  role: index % 2 ? 'assistant' : 'user',
  metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
  status: 'sent',
  external_id: null,
  token_count: null,
  is_synced: true,
  sequence_index: index % 2,
});

describe('conversation message pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = '/chat/conversation';
    useChatStore.setState({ messages: [] });
    jest.mocked(getConversationByExternalId).mockResolvedValue({
      success: true,
      data: { id: 'database-conversation' } as never,
    });
  });

  it('keeps a partial page final, without unnecessary loads', async () => {
    jest.mocked(getMessagePage).mockResolvedValue({
      success: true,
      data: {
        messages: [message(1)],
        hasMore: false,
        nextCursor: null,
      },
    });
    const { result } = renderHook(() => useConversationMessages());
    await waitFor(() => expect(result.current.loading.state).toBe('success'));
    expect(result.current.hasMoreMessages).toBe(false);
    await act(async () => {
      await result.current.loadMoreMessages();
    });
    expect(getMessagePage).toHaveBeenCalledTimes(1);
  });

  it('loads only the next page, preserving server order and existing messages', async () => {
    jest
      .mocked(getMessagePage)
      .mockResolvedValueOnce({
        success: true,
        data: {
          messages: [message(2), message(3)],
          hasMore: true,
          nextCursor: 'message-2',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          messages: [message(0), message(1)],
          hasMore: false,
          nextCursor: null,
        },
      });
    const { result } = renderHook(() => useConversationMessages());
    await waitFor(() => expect(result.current.loading.state).toBe('success'));
    expect(result.current.hasMoreMessages).toBe(true);
    await act(async () => {
      await result.current.loadMoreMessages();
    });
    expect(getMessagePage).toHaveBeenLastCalledWith('database-conversation', {
      limit: 20,
      beforeMessageId: 'message-2',
    });
    expect(useChatStore.getState().messages.map(item => item.text)).toEqual([
      '0',
      '1',
      '2',
      '3',
    ]);
    expect(result.current.hasMoreMessages).toBe(false);
  });

  it('ignores a late page from a conversation that has been left', async () => {
    let resolveOldPage!: (
      value: Awaited<ReturnType<typeof getMessagePage>>
    ) => void;
    jest.mocked(getMessagePage).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveOldPage = resolve;
        })
    );
    const { result, rerender } = renderHook(() => useConversationMessages());
    await waitFor(() => expect(getMessagePage).toHaveBeenCalledTimes(1));
    mockPathname = '/chat/other';
    jest.mocked(getConversationByExternalId).mockResolvedValue({
      success: true,
      data: { id: 'other-database' } as never,
    });
    jest.mocked(getMessagePage).mockResolvedValue({
      success: true,
      data: {
        messages: [message(9)],
        hasMore: false,
        nextCursor: null,
      },
    });
    rerender();
    await waitFor(() => expect(result.current.loading.state).toBe('success'));
    await act(async () => {
      resolveOldPage({
        success: true,
        data: {
          messages: [message(1)],
          hasMore: true,
          nextCursor: 'message-1',
        },
      });
    });
    expect(useChatStore.getState().messages.map(item => item.text)).toEqual([
      '9',
    ]);
    expect(result.current.hasMoreMessages).toBe(false);
  });

  it('does not start duplicate requests when load more is called twice in one render', async () => {
    let resolveMore!: (
      value: Awaited<ReturnType<typeof getMessagePage>>
    ) => void;
    jest
      .mocked(getMessagePage)
      .mockResolvedValueOnce({
        success: true,
        data: {
          messages: [message(2)],
          hasMore: true,
          nextCursor: 'message-2',
        },
      })
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveMore = resolve;
          })
      );
    const { result } = renderHook(() => useConversationMessages());
    await waitFor(() => expect(result.current.loading.state).toBe('success'));
    await act(async () => {
      const first = result.current.loadMoreMessages();
      const second = result.current.loadMoreMessages();
      resolveMore({
        success: true,
        data: { messages: [message(1)], hasMore: false, nextCursor: null },
      });
      await Promise.all([first, second]);
    });
    expect(getMessagePage).toHaveBeenCalledTimes(2);
  });

  it('reloads a conversation when it is revisited', async () => {
    jest.mocked(getMessagePage).mockResolvedValue({
      success: true,
      data: { messages: [message(1)], hasMore: false, nextCursor: null },
    });
    const { result, rerender } = renderHook(() => useConversationMessages());
    await waitFor(() => expect(result.current.loading.state).toBe('success'));
    mockPathname = '/settings';
    rerender();
    await waitFor(() => expect(result.current.dbConversationId).toBeNull());
    mockPathname = '/chat/conversation';
    rerender();
    await waitFor(() => expect(result.current.loading.state).toBe('success'));
    expect(getMessagePage).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().messages.map(item => item.text)).toEqual([
      '1',
    ]);
  });

  it('retains its cursor after a failed page so loading can be retried', async () => {
    jest
      .mocked(getMessagePage)
      .mockResolvedValueOnce({
        success: true,
        data: {
          messages: [message(2)],
          hasMore: true,
          nextCursor: 'message-2',
        },
      })
      .mockResolvedValueOnce({
        success: false,
        error: new Error('Temporary failure'),
      })
      .mockResolvedValueOnce({
        success: true,
        data: { messages: [message(1)], hasMore: false, nextCursor: null },
      });
    const { result } = renderHook(() => useConversationMessages());
    await waitFor(() => expect(result.current.loading.state).toBe('success'));
    await act(async () => {
      await result.current.loadMoreMessages();
    });
    expect(result.current.loading.state).toBe('error');
    expect(useChatStore.getState().messages.map(item => item.text)).toEqual([
      '2',
    ]);
    await act(async () => {
      await result.current.loadMoreMessages();
    });
    expect(getMessagePage).toHaveBeenLastCalledWith('database-conversation', {
      limit: 20,
      beforeMessageId: 'message-2',
    });
    expect(useChatStore.getState().messages.map(item => item.text)).toEqual([
      '1',
      '2',
    ]);
    expect(result.current.loading.state).toBe('success');
    expect(result.current.error).toBeNull();
  });
});
