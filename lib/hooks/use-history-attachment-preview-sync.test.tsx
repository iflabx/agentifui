import { useChatStore } from '@lib/stores/chat-store';
import { renderHook, waitFor } from '@testing-library/react';

import { useHistoryAttachmentPreviewSync } from './use-history-attachment-preview-sync';

const mockFetchAttachmentPreviewIds = jest.fn();

jest.mock('./history-attachment-preview', () => ({
  fetchAttachmentPreviewIds: (...args: unknown[]) =>
    mockFetchAttachmentPreviewIds(...args),
  hasPendingAttachmentPreviewSync: (
    messages: Array<{ attachments?: unknown[] }>
  ) => messages.some(message => (message.attachments?.length || 0) > 0),
}));

describe('useHistoryAttachmentPreviewSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useChatStore.setState({
      messages: [],
      streamingMessageId: null,
      isWaitingForResponse: false,
      currentConversationId: null,
      currentTaskId: null,
    });
  });

  it('applies resolved preview ids back into the chat store', async () => {
    const sourceMessages = [
      {
        id: 'user-1',
        text: 'open file',
        isUser: true,
        attachments: [
          {
            id: 'upload-file-1',
            name: 'notes.md',
            size: 128,
            type: 'text/markdown',
            upload_file_id: 'upload-file-1',
          },
        ],
      },
    ];

    const resolvedMessages = [
      {
        ...sourceMessages[0],
        attachments: [
          {
            ...sourceMessages[0].attachments[0],
            preview_file_id: 'preview-file-1',
          },
        ],
      },
    ];

    useChatStore.setState(state => ({
      ...state,
      messages: sourceMessages,
    }));

    mockFetchAttachmentPreviewIds.mockResolvedValue(resolvedMessages);

    renderHook(() =>
      useHistoryAttachmentPreviewSync({
        appId: 'app-1',
        conversationId: 'conv-1',
        messages: sourceMessages,
        userId: 'auth-user-1',
      })
    );

    await waitFor(() => {
      expect(useChatStore.getState().messages[0]?.attachments?.[0]).toEqual(
        expect.objectContaining({
          preview_file_id: 'preview-file-1',
        })
      );
    });
  });
});
