/** @jest-environment node */
import {
  dbMessageToChatMessage,
  getConversationIdFromPath,
  organizeMessages,
  shouldHandleScrollLoad,
  shouldLoadMoreMessages,
  shouldPreserveMessagesOnRouteTransition,
} from '@lib/hooks/use-conversation-messages/helpers';
import { createIdleLoadingStatus } from '@lib/hooks/use-conversation-messages/types';

describe('useConversationMessages helpers', () => {
  it('maps persistent conversation ids from chat routes', () => {
    expect(getConversationIdFromPath('/chat/abc')).toBe('abc');
    expect(getConversationIdFromPath('/chat/new')).toBeNull();
    expect(getConversationIdFromPath('/chat/temp-123')).toBeNull();
    expect(getConversationIdFromPath('/about')).toBeNull();
  });

  it('orders messages and maps attachments safely', () => {
    const messages = organizeMessages([
      {
        id: 'b',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'a',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ] as never);
    expect(messages.map(message => message.id)).toEqual(['a', 'b']);

    expect(
      dbMessageToChatMessage({
        id: 'm1',
        content: 'hello',
        role: 'user',
        external_id: 'ext-1',
        metadata: {
          attachments: [
            {
              id: 'file-1',
              name: 'demo.txt',
              size: 12,
              type: 'text/plain',
              upload_file_id: 'upload-1',
            },
          ],
        },
        token_count: 4,
        sequence_index: 2,
      } as never).attachments
    ).toHaveLength(1);
  });

  it('detects load-more and route transition preservation rules', () => {
    expect(
      shouldLoadMoreMessages({
        dbConversationId: 'db-1',
        hasMoreMessages: true,
        loading: createIdleLoadingStatus(),
      })
    ).toBe(true);
    expect(
      shouldLoadMoreMessages({
        dbConversationId: null,
        hasMoreMessages: true,
        loading: createIdleLoadingStatus(),
      })
    ).toBe(false);

    expect(
      shouldPreserveMessagesOnRouteTransition({
        previousPath: '/chat/new',
        externalId: 'conv-1',
        currentMessages: [{ id: '1' }],
      } as never)
    ).toBe(true);
    expect(
      shouldPreserveMessagesOnRouteTransition({
        previousPath: '/chat/old',
        externalId: 'conv-1',
        currentMessages: [],
      } as never)
    ).toBe(false);
  });

  it('checks scroll threshold before loading more', () => {
    expect(
      shouldHandleScrollLoad({
        hasMoreMessages: true,
        loading: createIdleLoadingStatus(),
        scrollTop: 10,
      })
    ).toBe(true);
    expect(
      shouldHandleScrollLoad({
        hasMoreMessages: true,
        loading: { ...createIdleLoadingStatus(), isLocked: true },
        scrollTop: 10,
      })
    ).toBe(false);
  });
});
