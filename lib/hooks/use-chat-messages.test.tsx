import {
  findDuplicateMessage,
  saveMessageRecord,
} from '@lib/services/client/messages-api';
import { useChatStore } from '@lib/stores/chat-store';
import { act, renderHook } from '@testing-library/react';

import { useChatMessages } from './use-chat-messages';

jest.mock('@lib/services/client/messages-api', () => ({
  saveMessageRecord: jest.fn(),
  findDuplicateMessage: jest.fn(),
  createPlaceholderAssistantMessageRecord: jest.fn(),
  updateMessageMetadataRecord: jest.fn(),
}));

describe('useChatMessages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useChatStore.setState({
      messages: [],
      streamingMessageId: null,
      isWaitingForResponse: false,
      currentConversationId: null,
      currentTaskId: null,
    });

    (findDuplicateMessage as jest.Mock).mockResolvedValue({
      success: true,
      data: null,
    });
    (saveMessageRecord as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        id: 'db-msg-1',
        content: 'partial reply',
        external_id: null,
      },
    });
  });

  it('persists stopped assistant metadata using the updated store message', async () => {
    useChatStore.setState(state => ({
      ...state,
      messages: [
        {
          id: 'assistant-1',
          text: 'partial reply',
          isUser: false,
          persistenceStatus: 'pending',
        },
      ],
    }));

    const { result } = renderHook(() => useChatMessages('user-1'));

    await act(async () => {
      await expect(
        result.current.saveStoppedAssistantMessage(
          {
            id: 'assistant-1',
            text: 'partial reply',
            isUser: false,
            persistenceStatus: 'pending',
          },
          'conv-1'
        )
      ).resolves.toBe(true);
    });

    expect(saveMessageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv-1',
        role: 'assistant',
        content: 'partial reply',
        metadata: expect.objectContaining({
          stopped_manually: true,
          stopped_at: expect.any(String),
        }),
      })
    );

    expect(useChatStore.getState().messages[0]).toEqual(
      expect.objectContaining({
        wasManuallyStopped: true,
        persistenceStatus: 'saved',
        db_id: 'db-msg-1',
      })
    );
  });
});
