import { AppRequestError } from '@lib/errors/app-error';
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
  collectChatDisplayFiles:
    jest.requireActual('./file-mappers').collectChatDisplayFiles,
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

  it('reports acceptance and replaces the source path without requiring the source ID to stay preferred', async () => {
    const { input, userMessage } = createInput();
    useChatStore.setState({
      messages: [
        { id: 'prefix', text: 'prefix', isUser: true },
        {
          id: 'client-source',
          db_id: 'saved-source',
          text: 'old question',
          isUser: true,
        },
        { id: 'old-answer', text: 'old answer', isUser: false },
        { id: 'old-tail', text: 'old tail', isUser: true },
      ],
    });
    input.addMessage.mockImplementation(() => {
      useChatStore.setState(state => ({
        messages: [...state.messages, userMessage],
      }));
      return userMessage;
    });
    mockPrepareChatSubmitConversationState.mockReturnValueOnce(false);
    mockStartExistingChatConversation.mockImplementationOnce(async options => {
      options.onAccepted({ externalId: 'conv-1', taskId: 'task-1' });
      return {
        answerStream: (async function* () {})(),
        finalDbConvUUID: 'db-1',
      };
    });
    expect(
      await executeChatSubmit({ ...input, editSourceId: 'client-source' })
    ).toEqual({ ok: true, surfaced: true, editResult: true });
    expect(useChatStore.getState().messages.map(message => message.id)).toEqual(
      ['prefix', userMessage.id]
    );
  });

  it('does not report acceptance or hide the source when upstream refuses the edit', async () => {
    const { input } = createInput();
    useChatStore.setState({
      messages: [{ id: 'source', text: 'original', isUser: true }],
    });
    mockPrepareChatSubmitConversationState.mockReturnValueOnce(false);
    mockStartExistingChatConversation.mockRejectedValueOnce(
      new Error('refused')
    );
    expect(
      await executeChatSubmit({ ...input, editSourceId: 'source' })
    ).toEqual({ ok: false, surfaced: true, editResult: false });
    expect(useChatStore.getState().messages[0].id).toBe('source');
    expect(mockHandleChatSubmitStreamError).not.toHaveBeenCalled();
  });

  it('keeps a dispatched edit uncertain after transport loss without persisting an error answer', async () => {
    const { input } = createInput();
    useChatStore.setState({
      messages: [{ id: 'source', text: 'original', isUser: true }],
    });
    mockPrepareChatSubmitConversationState.mockReturnValueOnce(false);
    mockStartExistingChatConversation.mockImplementationOnce(async options => {
      options.onDispatch();
      throw new Error('connection lost');
    });
    const result = await executeChatSubmit({
      ...input,
      editSourceId: 'source',
      dbConversationUUID: 'local',
    });
    expect(result).toMatchObject({
      ok: false,
      editResult: {
        status: 'unknown',
        submissionId: expect.any(String),
        check: expect.any(Function),
      },
    });
    expect(mockHandleChatSubmitStreamError).not.toHaveBeenCalled();
    expect(input.saveErrorPlaceholder).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages[0].id).toBe('source');
  });

  it('treats an unacknowledged normal EOF as unknown and does not persist it as an accepted turn', async () => {
    const { input } = createInput();
    mockPrepareChatSubmitConversationState.mockReturnValueOnce(false);
    mockStartExistingChatConversation.mockImplementationOnce(async options => {
      options.onDispatch();
      return {
        answerStream: (async function* () {})(),
        finalDbConvUUID: 'local',
      };
    });
    const result = await executeChatSubmit({
      ...input,
      editSourceId: 'source',
      dbConversationUUID: 'local',
    });
    expect(result).toMatchObject({
      ok: false,
      editResult: { status: 'unknown' },
    });
    expect(mockPersistChatMessagesAfterStreaming).not.toHaveBeenCalled();
    expect(mockFinalizeChatSubmitStream).not.toHaveBeenCalled();
  });

  it('does not roll an accepted edit back when later generation fails', async () => {
    const { input, userMessage } = createInput();
    useChatStore.setState({
      messages: [{ id: 'source', text: 'original', isUser: true }],
    });
    input.addMessage.mockImplementation(() => {
      useChatStore.setState(state => ({
        messages: [...state.messages, userMessage],
      }));
      return userMessage;
    });
    mockPrepareChatSubmitConversationState.mockReturnValueOnce(false);
    mockStartExistingChatConversation.mockImplementationOnce(async options => {
      options.onAccepted({ externalId: 'native', taskId: 'task' });
      throw new Error('generation failed');
    });
    expect(
      await executeChatSubmit({ ...input, editSourceId: 'source' })
    ).toMatchObject({ ok: true, editResult: true });
    expect(useChatStore.getState().messages.map(message => message.id)).toEqual(
      [userMessage.id]
    );
    expect(mockHandleChatSubmitStreamError).toHaveBeenCalledTimes(1);
  });

  it('clears only its local partial stream on unknown EOF without persisting it', async () => {
    const { input } = createInput();
    useChatStore.setState({
      messages: [
        { id: 'source', text: 'original', isUser: true },
        { id: 'partial', text: 'partial reply', isUser: false },
      ],
    });
    mockPrepareChatSubmitConversationState.mockReturnValueOnce(false);
    mockStartExistingChatConversation.mockImplementationOnce(async options => {
      options.onDispatch();
      return {
        answerStream: (async function* () {
          yield 'partial reply';
        })(),
        finalDbConvUUID: 'local',
      };
    });
    mockConsumeChatAnswerStream.mockResolvedValueOnce({
      assistantMessageId: 'partial',
      assistantText: 'partial reply',
    });
    const result = await executeChatSubmit({
      ...input,
      editSourceId: 'source',
      dbConversationUUID: 'local',
    });
    expect(result.editResult).toMatchObject({ status: 'unknown' });
    expect(input.finalizeStreamingMessage).toHaveBeenCalledWith('partial');
    expect(useChatStore.getState().messages.map(message => message.id)).toEqual(
      ['source']
    );
    expect(mockPersistChatMessagesAfterStreaming).not.toHaveBeenCalled();
    expect(mockFinalizeChatSubmitStream).not.toHaveBeenCalled();
  });

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

  it('keeps the first structured form mounted until acceptance and preserves a refused draft', async () => {
    const { input } = createInput();
    mockStartNewChatConversation.mockImplementationOnce(async () => {
      expect(input.addMessage).not.toHaveBeenCalled();
      expect(input.setIsWelcomeScreen).not.toHaveBeenCalled();
      throw new AppRequestError('Input requirements changed', 400);
    });
    const result = await executeChatSubmit({
      ...input,
      isWelcomeScreen: true,
      inputs: { Exact_Key: 'keep' },
    });
    expect(result).toMatchObject({
      ok: false,
      surfaced: false,
      errorMessage: expect.any(String),
    });
    expect(input.addMessage).not.toHaveBeenCalled();
    expect(input.setIsWelcomeScreen).not.toHaveBeenCalled();
    expect(mockHandleChatSubmitStreamError).not.toHaveBeenCalled();
    expect(mockFinalizeChatSubmitStream).not.toHaveBeenCalled();
  });

  it('adds the structured user message with display attachments only after acceptance', async () => {
    const { input } = createInput();
    mockStartNewChatConversation.mockImplementationOnce(async options => {
      expect(input.addMessage).not.toHaveBeenCalled();
      expect(options.payload.files).toBeUndefined();
      options.onAccepted({ externalId: 'native', taskId: 'task' });
      expect(input.addMessage).toHaveBeenCalledWith(options.userMessage);
      return {
        answerStream: (async function* () {})(),
        finalDbConvUUID: 'db-1',
      };
    });
    const attached = {
      upload_file_id: 'input-file',
      name: 'source.txt',
      type: 'document',
    };
    const result = await executeChatSubmit({
      ...input,
      isWelcomeScreen: true,
      inputs: { Exact_File: attached },
    });
    expect(result.ok).toBe(true);
    expect(mockMapChatUploadFilesToMessageAttachments).toHaveBeenCalledWith(
      [attached],
      'app-1'
    );
    expect(input.setIsWelcomeScreen).toHaveBeenCalledWith(false);
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

  it('passes the new conversation persistence promise into post-stream saving', async () => {
    const conversationPersistencePromise = Promise.resolve('db-1');
    mockStartNewChatConversation.mockResolvedValueOnce({
      answerStream: (async function* () {})(),
      finalRealConvId: 'conv-1',
      finalTaskId: 'task-1',
      finalDbConvUUID: null,
      completionPromise: Promise.resolve({}),
      conversationPersistencePromise,
    });

    const { input } = createInput();
    await executeChatSubmit(input);

    expect(mockPersistChatMessagesAfterStreaming).toHaveBeenCalledWith(
      expect.objectContaining({ conversationPersistencePromise })
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

  it('recovers a swallowed visible answer tail from open think content before persistence', async () => {
    const { input } = createInput();
    const visibleAnswer =
      '比斯兔建议今晚可以试试二食堂的小火锅，或者一食堂的风味档口。';

    mockConsumeChatAnswerStream.mockResolvedValueOnce({
      assistantMessageId: 'assistant-1',
      assistantText: `<think>Here is a thinking process:\n\n1. 先分析用户晚饭需求。\n\n2. 再结合校内餐饮选项。\n\n3. 最后给出直接推荐。\n\n${visibleAnswer}`,
    });

    await executeChatSubmit(input);

    expect(input.updateMessage).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({
        text: `<think>Here is a thinking process:\n\n1. 先分析用户晚饭需求。\n\n2. 再结合校内餐饮选项。\n\n3. 最后给出直接推荐。</think>\n\n${visibleAnswer}`,
      })
    );

    expect(mockPersistChatMessagesAfterStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantFallback: expect.objectContaining({
          text: `<think>Here is a thinking process:\n\n1. 先分析用户晚饭需求。\n\n2. 再结合校内餐饮选项。\n\n3. 最后给出直接推荐。</think>\n\n${visibleAnswer}`,
          metadata: expect.objectContaining({
            frontend_metadata: expect.objectContaining({
              sequence_index: 1,
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

  it('prunes a short prefix think block before persisting a completed assistant reply', async () => {
    const { input } = createInput();

    mockConsumeChatAnswerStream.mockResolvedValueOnce({
      assistantMessageId: 'assistant-1',
      assistantText:
        '<think>先分析时间请求</think>\n\n<think>先分析时间请求，并补充换算步骤</think>\n\nVisible answer',
    });

    await executeChatSubmit(input);

    expect(input.updateMessage).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({
        text: '<think>先分析时间请求，并补充换算步骤</think>\n\nVisible answer',
      })
    );

    expect(mockPersistChatMessagesAfterStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantFallback: expect.objectContaining({
          text: '<think>先分析时间请求，并补充换算步骤</think>\n\nVisible answer',
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

  it('does not fabricate an incomplete assistant response for a confirmed pre-row stop', async () => {
    const { input } = createInput();
    mockConsumeChatAnswerStream.mockResolvedValueOnce({
      assistantMessageId: null,
      assistantText: '',
    });
    await executeChatSubmit({
      ...input,
      viewScope: {
        isCurrent: () => false,
        isStopped: () => true,
        onRouteAdopted: jest.fn(),
      },
    });
    expect(mockPersistChatMessagesAfterStreaming).toHaveBeenCalledWith(
      expect.objectContaining({ assistantFallback: null })
    );
  });
});
