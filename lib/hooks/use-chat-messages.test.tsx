import {
  findDuplicateMessage,
  saveMessageRecord,
  updateMessageMetadataRecord,
} from '@lib/services/client/messages-api';
import { useChatStore } from '@lib/stores/chat-store';
import type { ChatMessage } from '@lib/stores/chat-store';
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
        client_message_id: 'assistant-1',
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
          client_message_id: 'assistant-1',
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

  it('joins concurrent saves before duplicate lookup completes', async () => {
    const message: ChatMessage = {
      id: 'user-message-1',
      text: 'hello',
      isUser: true,
    };
    const lookup = Promise.withResolvers<{ success: true; data: null }>();
    (findDuplicateMessage as jest.Mock).mockReturnValue(lookup.promise);
    const { result } = renderHook(() => useChatMessages('user-1'));

    await act(async () => {
      const first = result.current.saveMessage(message, 'conv-1');
      const second = result.current.saveMessage(message, 'conv-1');
      await Promise.resolve();
      expect(findDuplicateMessage).toHaveBeenCalledTimes(1);
      lookup.resolve({ success: true, data: null });
      await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    });

    expect(saveMessageRecord).toHaveBeenCalledTimes(1);
    expect(saveMessageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { client_message_id: message.id },
      })
    );
    expect(result.current.isMessageSaving(message.id)).toBe(false);
  });

  it('joins an in-flight save after the original hook unmounts', async () => {
    const message: ChatMessage = {
      id: 'user-message-1',
      text: 'hello',
      isUser: true,
    };
    const lookup = Promise.withResolvers<{ success: true; data: null }>();
    (findDuplicateMessage as jest.Mock).mockReturnValue(lookup.promise);
    const original = renderHook(() => useChatMessages('user-1'));
    let first!: Promise<boolean>;
    act(() => {
      first = original.result.current.saveMessage(message, 'conv-1');
    });
    original.unmount();
    const replacement = renderHook(() => useChatMessages('user-1'));

    await act(async () => {
      const second = replacement.result.current.saveMessage(message, 'conv-1');
      lookup.resolve({ success: true, data: null });
      await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    });

    expect(findDuplicateMessage).toHaveBeenCalledTimes(1);
    expect(saveMessageRecord).toHaveBeenCalledTimes(1);
  });

  it('does not collapse different messages with identical text', async () => {
    const { result } = renderHook(() => useChatMessages('user-1'));
    await act(async () => {
      await result.current.saveMessage(
        { id: 'turn-1', text: 'hello', isUser: true },
        'conv-1'
      );
      await result.current.saveMessage(
        { id: 'turn-2', text: 'hello', isUser: true },
        'conv-1'
      );
    });
    expect(findDuplicateMessage).toHaveBeenNthCalledWith(
      1,
      'hello',
      'user',
      'conv-1',
      'turn-1'
    );
    expect(findDuplicateMessage).toHaveBeenNthCalledWith(
      2,
      'hello',
      'user',
      'conv-1',
      'turn-2'
    );
    expect(saveMessageRecord).toHaveBeenCalledTimes(2);
  });

  it('skips a stale snapshot when the store already has the saved identity', async () => {
    const message: ChatMessage = {
      id: 'user-message-1',
      text: 'hello',
      isUser: true,
    };
    useChatStore.setState({
      messages: [{ ...message, db_id: 'saved-1', persistenceStatus: 'saved' }],
    });
    const { result } = renderHook(() => useChatMessages('user-1'));
    await act(async () => {
      await expect(result.current.saveMessage(message, 'conv-1')).resolves.toBe(
        true
      );
    });
    expect(saveMessageRecord).not.toHaveBeenCalled();
    expect(findDuplicateMessage).not.toHaveBeenCalled();
  });

  it('retries from the captured snapshot when route loading clears the store', async () => {
    jest.useFakeTimers();
    try {
      const message: ChatMessage = {
        id: 'assistant-removed',
        text: 'reply',
        isUser: false,
      };
      (saveMessageRecord as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: new Error('temporary failure'),
      });
      const { result } = renderHook(() => useChatMessages('user-1'));
      await act(async () => {
        await expect(
          result.current.saveMessage(message, 'conv-1')
        ).resolves.toBe(false);
      });
      act(() => useChatStore.getState().clearMessages());
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      expect(saveMessageRecord).toHaveBeenCalledTimes(2);
      expect(saveMessageRecord).toHaveBeenLastCalledWith(
        expect.objectContaining({
          content: 'reply',
          metadata: { client_message_id: 'assistant-removed' },
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
