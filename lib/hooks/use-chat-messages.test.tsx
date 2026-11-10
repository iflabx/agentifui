import {
  findDuplicateMessage,
  saveMessageRecord,
  updateMessageMetadataRecord,
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
    (updateMessageMetadataRecord as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        id: 'db-msg-1',
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
          stopped_response_text: 'partial reply',
        }),
      })
    );
    expect(updateMessageMetadataRecord).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      messageId: 'db-msg-1',
      metadata: expect.objectContaining({
        stopped_manually: true,
        stopped_at: expect.any(String),
        stopped_response_text: 'partial reply',
      }),
    });

    expect(useChatStore.getState().messages[0]).toEqual(
      expect.objectContaining({
        wasManuallyStopped: true,
        persistenceStatus: 'saved',
        db_id: 'db-msg-1',
      })
    );
  });

  it('patches stopped metadata when duplicate detection short-circuits message saving', async () => {
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
    (findDuplicateMessage as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: {
        id: 'db-existing-1',
        external_id: null,
      },
    });
    (updateMessageMetadataRecord as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: {
        id: 'db-existing-1',
      },
    });

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

    expect(saveMessageRecord).not.toHaveBeenCalled();
    expect(updateMessageMetadataRecord).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      messageId: 'db-existing-1',
      metadata: expect.objectContaining({
        stopped_manually: true,
        stopped_at: expect.any(String),
        stopped_response_text: 'partial reply',
      }),
    });
    expect(useChatStore.getState().messages[0]).toEqual(
      expect.objectContaining({
        wasManuallyStopped: true,
        persistenceStatus: 'saved',
        db_id: 'db-existing-1',
      })
    );
  });

  it('normalizes assistant fallback snapshots before saving payloads', async () => {
    useChatStore.setState(state => ({
      ...state,
      messages: [
        {
          id: 'assistant-1',
          text: `<think>Here is a thinking process:

1. 先分析用户需求。

2. 再给出方案。

比斯兔建议今晚可以试试二食堂的小火锅。</think>

The answer was not generated completely. Please retry.`,
          isUser: false,
          persistenceStatus: 'pending',
          metadata: {
            frontend_metadata: {
              sequence_index: 1,
              incomplete_assistant_fallback: true,
            },
          },
        },
      ],
    }));

    const { result } = renderHook(() => useChatMessages('user-1'));

    await act(async () => {
      await expect(
        result.current.saveMessage(
          {
            id: 'assistant-1',
            text: `<think>Here is a thinking process:

1. 先分析用户需求。

2. 再给出方案。

比斯兔建议今晚可以试试二食堂的小火锅。</think>

The answer was not generated completely. Please retry.`,
            isUser: false,
            persistenceStatus: 'pending',
            metadata: {
              frontend_metadata: {
                sequence_index: 1,
                incomplete_assistant_fallback: true,
              },
            },
          },
          'conv-1'
        )
      ).resolves.toBe(true);
    });

    expect(saveMessageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `<think>Here is a thinking process:

1. 先分析用户需求。

2. 再给出方案。</think>

比斯兔建议今晚可以试试二食堂的小火锅。`,
        metadata: {
          frontend_metadata: {
            sequence_index: 1,
          },
        },
      })
    );
  });

  it('releases the saving lock before retrying a failed save', async () => {
    jest.useFakeTimers();
    try {
      useChatStore.setState(state => ({
        ...state,
        messages: [
          {
            id: 'assistant-1',
            text: 'recovered reply',
            isUser: false,
            persistenceStatus: 'pending',
          },
        ],
      }));

      (saveMessageRecord as jest.Mock)
        .mockResolvedValueOnce({
          success: false,
          error: { message: 'temporary failure' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            id: 'db-msg-1',
            content: 'recovered reply',
            external_id: null,
          },
        });

      const { result } = renderHook(() => useChatMessages('user-1'));

      await act(async () => {
        await expect(
          result.current.saveMessage(
            {
              id: 'assistant-1',
              text: 'recovered reply',
              isUser: false,
              persistenceStatus: 'pending',
            },
            'conv-1'
          )
        ).resolves.toBe(false);
      });

      expect(saveMessageRecord).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(saveMessageRecord).toHaveBeenCalledTimes(2);
      expect(useChatStore.getState().messages[0]).toEqual(
        expect.objectContaining({
          persistenceStatus: 'saved',
          db_id: 'db-msg-1',
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('patches stopped metadata after an in-flight save finishes', async () => {
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

    let resolveSaveRecord:
      | ((value: {
          success: true;
          data: { id: string; content: string; external_id: null };
        }) => void)
      | null = null;

    (saveMessageRecord as jest.Mock).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveSaveRecord = resolve;
        })
    );

    const { result } = renderHook(() => useChatMessages('user-1'));

    let initialSavePromise: Promise<boolean> | null = null;
    await act(async () => {
      initialSavePromise = result.current.saveMessage(
        {
          id: 'assistant-1',
          text: 'partial reply',
          isUser: false,
          persistenceStatus: 'pending',
        },
        'conv-1'
      );
      await Promise.resolve();
    });

    let stoppedPromise: Promise<boolean> | null = null;
    await act(async () => {
      stoppedPromise = result.current.saveStoppedAssistantMessage(
        {
          id: 'assistant-1',
          text: 'partial reply',
          isUser: false,
          persistenceStatus: 'pending',
        },
        'conv-1'
      );
      await Promise.resolve();
    });

    expect(saveMessageRecord).toHaveBeenCalledTimes(1);
    expect(updateMessageMetadataRecord).not.toHaveBeenCalled();
    expect(resolveSaveRecord).not.toBeNull();
    expect(stoppedPromise).not.toBeNull();

    await act(async () => {
      if (!resolveSaveRecord || !stoppedPromise || !initialSavePromise) {
        throw new Error('Expected deferred save and stopped promise');
      }

      resolveSaveRecord({
        success: true,
        data: {
          id: 'db-msg-1',
          content: 'partial reply',
          external_id: null,
        },
      });

      await initialSavePromise;
      await stoppedPromise;
    });

    expect(updateMessageMetadataRecord).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      messageId: 'db-msg-1',
      metadata: expect.objectContaining({
        stopped_manually: true,
        stopped_at: expect.any(String),
        stopped_response_text: 'partial reply',
      }),
    });
    expect(useChatStore.getState().messages[0]).toEqual(
      expect.objectContaining({
        wasManuallyStopped: true,
        persistenceStatus: 'saved',
        db_id: 'db-msg-1',
      })
    );
  });
});
