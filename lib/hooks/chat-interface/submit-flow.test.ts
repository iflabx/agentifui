import { useChatStore } from '@lib/stores/chat-store';

import type { ChatResolvedAppConfig } from './app-config';
import { executeChatSubmit } from './submit-flow';

const mockMapChatUploadFilesToDifyFiles = jest.fn();
const mockMapChatUploadFilesToMessageAttachments = jest.fn();
const mockPersistChatMessagesAfterStreaming = jest.fn();
const mockSyncChatStateAfterStreaming = jest.fn();
const mockStartNewChatConversation = jest.fn();
const mockStartExistingChatConversation = jest.fn();
const mockPrepareChatSubmitConversationState = jest.fn();
const mockFinalizeChatSubmitStream = jest.fn();
const mockHandleChatSubmitStreamError = jest.fn();
const mockApplyChatCompletionMetadata = jest.fn();
const mockConsumeChatAnswerStream = jest.fn();

jest.mock('./file-mappers', () => ({
  mapChatUploadFilesToDifyFiles: (...args: unknown[]) =>
    mockMapChatUploadFilesToDifyFiles(...args),
  mapChatUploadFilesToMessageAttachments: (...args: unknown[]) =>
    mockMapChatUploadFilesToMessageAttachments(...args),
}));

jest.mock('./post-stream', () => ({
  persistChatMessagesAfterStreaming: (...args: unknown[]) =>
    mockPersistChatMessagesAfterStreaming(...args),
  syncChatStateAfterStreaming: (...args: unknown[]) =>
    mockSyncChatStateAfterStreaming(...args),
}));

jest.mock('./submit-start', () => ({
  startNewChatConversation: (...args: unknown[]) =>
    mockStartNewChatConversation(...args),
  startExistingChatConversation: (...args: unknown[]) =>
    mockStartExistingChatConversation(...args),
  prepareChatSubmitConversationState: (...args: unknown[]) =>
    mockPrepareChatSubmitConversationState(...args),
}));

jest.mock('./submit-recovery', () => ({
  finalizeChatSubmitStream: (...args: unknown[]) =>
    mockFinalizeChatSubmitStream(...args),
  handleChatSubmitStreamError: (...args: unknown[]) =>
    mockHandleChatSubmitStreamError(...args),
}));

jest.mock('./stream-consume', () => ({
  applyChatCompletionMetadata: (...args: unknown[]) =>
    mockApplyChatCompletionMetadata(...args),
  consumeChatAnswerStream: (...args: unknown[]) =>
    mockConsumeChatAnswerStream(...args),
}));

describe('executeChatSubmit', () => {
  const appConfig = {
    appId: 'app-1',
    instance: {
      instance_id: 'app-1',
      display_name: 'App 1',
    },
  } as unknown as ChatResolvedAppConfig;

  const createInput = () => {
    const userMessage = {
      id: 'user-1',
      text: '从物理学角度解释模型推理',
      isUser: true,
      persistenceStatus: 'pending' as const,
      sequence_index: 0,
    };

    return {
      input: {
        message: '从物理学角度解释模型推理',
        currentUserId: 'user-1',
        appConfig,
        isWelcomeScreen: false,
        currentPathname: '/chat/new',
        difyConversationId: null,
        dbConversationUUID: null,
        isSubmittingRef: { current: false },
        chunkBufferRef: { current: '' },
        appendTimerRef: { current: null },
        setIsWelcomeScreen: jest.fn(),
        setDifyConversationId: jest.fn(),
        setDbConversationUUID: jest.fn(),
        setCurrentConversationId: jest.fn(),
        setCurrentTaskId: jest.fn(),
        setIsWaitingForResponse: jest.fn(),
        addMessage: jest.fn(() => userMessage),
        updateMessage: jest.fn(),
        setMessageError: jest.fn(),
        finalizeStreamingMessage: jest.fn(),
        markAsManuallyStopped: jest.fn(),
        updatePendingStatus: jest.fn(),
        saveMessage: jest.fn(),
        saveStoppedAssistantMessage: jest.fn(),
        saveErrorPlaceholder: jest.fn(),
        initiateNewConversation: jest.fn(),
        navigateToConversation: jest.fn(),
        flushChunkBuffer: jest.fn(),
        chunkAppendInterval: 30,
        moderationT: jest.fn((key: string) => key),
        incompleteAnswerMessage: '回答未完整生成，请重试。',
      },
      userMessage,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useChatStore.setState({
      messages: [],
      streamingMessageId: null,
      isWaitingForResponse: false,
      currentConversationId: null,
      currentTaskId: null,
    });

    mockMapChatUploadFilesToDifyFiles.mockReturnValue(undefined);
    mockMapChatUploadFilesToMessageAttachments.mockReturnValue(undefined);
    mockPrepareChatSubmitConversationState.mockReturnValue(true);
    mockStartNewChatConversation.mockResolvedValue({
      answerStream: (async function* () {})(),
      finalRealConvId: 'conv-1',
      finalTaskId: 'task-1',
      finalDbConvUUID: 'db-1',
      completionPromise: Promise.resolve({}),
    });
    mockConsumeChatAnswerStream.mockResolvedValue({
      assistantMessageId: 'assistant-1',
      assistantText: '完整回答',
    });
    mockApplyChatCompletionMetadata.mockResolvedValue({
      userMessageFileIds: ['preview-file-1'],
      usage: { total_tokens: 8 },
      metadata: { model: 'deepseek' },
      retrieverResources: [],
    });
    mockPersistChatMessagesAfterStreaming.mockResolvedValue('db-1');
    mockSyncChatStateAfterStreaming.mockReturnValue(undefined);
    mockFinalizeChatSubmitStream.mockResolvedValue(undefined);
    mockHandleChatSubmitStreamError.mockReturnValue(undefined);
  });

  it('persists messages before syncing route state for a new conversation', async () => {
    const callOrder: string[] = [];
    mockPersistChatMessagesAfterStreaming.mockImplementation(async () => {
      callOrder.push('persist');
      return 'db-1';
    });
    mockSyncChatStateAfterStreaming.mockImplementation(() => {
      callOrder.push('sync');
    });

    const { input } = createInput();

    await executeChatSubmit(input);

    expect(callOrder).toEqual(['persist', 'sync']);
    expect(mockHandleChatSubmitStreamError).not.toHaveBeenCalled();
  });

  it('passes an assistant fallback snapshot into persistence', async () => {
    const { input } = createInput();

    await executeChatSubmit(input);

    expect(mockPersistChatMessagesAfterStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessagePreviewFileIds: ['preview-file-1'],
        assistantMessageId: 'assistant-1',
        assistantFallback: expect.objectContaining({
          id: 'assistant-1',
          text: '完整回答',
          tokenCount: 8,
          metadata: expect.objectContaining({
            dify_metadata: { model: 'deepseek' },
          }),
        }),
      })
    );
  });

  it('passes moderation translator into stream error recovery', async () => {
    const { input } = createInput();
    const thrownError = new Error('blocked');
    mockStartNewChatConversation.mockRejectedValueOnce(thrownError);

    await executeChatSubmit(input);

    expect(mockHandleChatSubmitStreamError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: thrownError,
        moderationT: input.moderationT,
      })
    );
  });

  it('materializes a localized fallback when the assistant reply ends with draft-only think content', async () => {
    const { input } = createInput();

    mockConsumeChatAnswerStream.mockResolvedValueOnce({
      assistantMessageId: 'assistant-1',
      assistantText: '<think>Plan steps\n\n**生成内容**：\n* bullet',
    });

    await executeChatSubmit(input);

    expect(input.updateMessage).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({
        text: '<think>Plan steps\n\n**生成内容**：\n* bullet</think>\n\n回答未完整生成，请重试。',
      })
    );

    expect(mockPersistChatMessagesAfterStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantFallback: expect.objectContaining({
          text: '<think>Plan steps\n\n**生成内容**：\n* bullet</think>\n\n回答未完整生成，请重试。',
          metadata: expect.objectContaining({
            frontend_metadata: expect.objectContaining({
              incomplete_assistant_fallback: true,
            }),
          }),
        }),
      })
    );
  });

  it('prunes duplicated think noise before persisting a completed assistant reply', async () => {
    const { input } = createInput();

    mockConsumeChatAnswerStream.mockResolvedValueOnce({
      assistantMessageId: 'assistant-1',
      assistantText:
        '<think>先分析时间请求</think>\n\n<think>先分析时间请求</think>\n\nVisible answer<think>Visible answer</think>',
    });

    await executeChatSubmit(input);

    expect(input.updateMessage).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({
        text: '<think>先分析时间请求</think>\n\nVisible answer',
      })
    );

    expect(mockPersistChatMessagesAfterStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantFallback: expect.objectContaining({
          text: '<think>先分析时间请求</think>\n\nVisible answer',
          metadata: expect.objectContaining({
            frontend_metadata: expect.objectContaining({
              sequence_index: 1,
            }),
          }),
        }),
      })
    );
  });

  it('prunes conservative subset think noise before persisting a completed assistant reply', async () => {
    const { input } = createInput();
    const smallerThink =
      '先确认图书馆开放时间，再核对节假日安排，最后补充借阅服务与自习区开放提示，确保给出完整准确的答复。';
    const largerThink = `${smallerThink}用户问的是图书馆“开门了吗”，我还需要核对当前日期时间，再说明资料里只有研讨室预约时间，没有完整的全馆开闭馆表，并提醒用户以当天公告与图书馆联系方式为准。`;
    const answerTail =
      '如果遇到节假日调整，请以当天公告为准，并提前安排借阅和自习时间，同时留意临时闭馆与预约规则变化。';
    const visibleAnswer = `比斯兔竖起大耳朵查了一下，图书馆今天正常开放。${answerTail}`;

    mockConsumeChatAnswerStream.mockResolvedValueOnce({
      assistantMessageId: 'assistant-1',
      assistantText: `<think>${smallerThink}</think>\n\n<think>${largerThink}</think>\n\n${visibleAnswer}<think>${answerTail}</think>`,
    });

    await executeChatSubmit(input);

    expect(input.updateMessage).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({
        text: `<think>${largerThink}</think>\n\n${visibleAnswer}`,
      })
    );

    expect(mockPersistChatMessagesAfterStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantFallback: expect.objectContaining({
          text: `<think>${largerThink}</think>\n\n${visibleAnswer}`,
        }),
      })
    );
  });

  it('does not inject incomplete fallback for manually stopped draft-only content', async () => {
    const { input } = createInput();

    useChatStore.setState({
      messages: [
        {
          id: 'assistant-1',
          text: '<think>Plan steps\n\n**生成内容**：\n* bullet',
          isUser: false,
          isStreaming: false,
          wasManuallyStopped: true,
          metadata: {
            frontend_metadata: {
              stopped_manually: true,
            },
          },
        },
      ],
    });

    mockConsumeChatAnswerStream.mockResolvedValueOnce({
      assistantMessageId: 'assistant-1',
      assistantText: '<think>Plan steps\n\n**生成内容**：\n* bullet',
    });

    await executeChatSubmit(input);

    expect(input.updateMessage).not.toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({
        text: expect.stringContaining('回答未完整生成，请重试。'),
      })
    );

    expect(mockPersistChatMessagesAfterStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantFallback: expect.objectContaining({
          text: '<think>Plan steps\n\n**生成内容**：\n* bullet',
          wasManuallyStopped: true,
          metadata: expect.objectContaining({
            frontend_metadata: expect.not.objectContaining({
              incomplete_assistant_fallback: true,
            }),
          }),
        }),
      })
    );
  });
});
