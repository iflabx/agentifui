import { persistChatMessagesAfterStreaming } from './post-stream';

const mockGetChatStoreState = jest.fn();
const mockPersistUserMessageIfNeeded = jest.fn();
const mockResolveDbConversationUuidByExternalId = jest.fn();
const mockUpdateMessageMetadataRecord = jest.fn();

jest.mock('@lib/stores/chat-store', () => ({
  useChatStore: {
    getState: (...args: unknown[]) => mockGetChatStoreState(...args),
  },
}));

jest.mock('./conversation-db', () => ({
  persistUserMessageIfNeeded: (...args: unknown[]) =>
    mockPersistUserMessageIfNeeded(...args),
  resolveDbConversationUuidByExternalId: (...args: unknown[]) =>
    mockResolveDbConversationUuidByExternalId(...args),
}));

jest.mock('@lib/services/client/messages-api', () => ({
  updateMessageMetadataRecord: (...args: unknown[]) =>
    mockUpdateMessageMetadataRecord(...args),
}));

describe('persistChatMessagesAfterStreaming', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    window.history.pushState({}, '', '/');

    mockGetChatStoreState.mockReturnValue({
      messages: [],
      currentConversationId: null,
      currentTaskId: null,
    });
    mockPersistUserMessageIfNeeded.mockReset();
    mockResolveDbConversationUuidByExternalId.mockReset();
    mockUpdateMessageMetadataRecord.mockReset();
    mockUpdateMessageMetadataRecord.mockResolvedValue({
      success: true,
      data: { id: 'db-msg-user-1' },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('saves the assistant fallback snapshot when the store message is gone', async () => {
    const saveMessage = jest.fn().mockResolvedValue(true);

    await persistChatMessagesAfterStreaming({
      finalDbConvUUID: 'db-1',
      dbConversationUUID: null,
      userMessage: {
        id: 'user-1',
        text: '从生物学角度介绍大模型推理',
        isUser: true,
        persistenceStatus: 'saved',
      },
      assistantMessageId: 'assistant-1',
      assistantFallback: {
        id: 'assistant-1',
        text: '这是完整的回答',
      },
      setDbConversationUUID: jest.fn(),
      finalizeStreamingMessage: jest.fn(),
      updateMessage: jest.fn(),
      saveMessage,
    });

    expect(saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-1',
        text: '这是完整的回答',
        isUser: false,
        role: 'assistant',
        sequence_index: 1,
      }),
      'db-1'
    );
  });

  it('uses the longer fallback text when the store message is truncated', async () => {
    mockGetChatStoreState.mockReturnValue({
      messages: [
        {
          id: 'assistant-1',
          text: '这是',
          isUser: false,
          persistenceStatus: 'pending',
        },
      ],
      currentConversationId: null,
      currentTaskId: null,
    });

    const saveMessage = jest.fn().mockResolvedValue(true);

    await persistChatMessagesAfterStreaming({
      finalDbConvUUID: 'db-1',
      dbConversationUUID: null,
      userMessage: {
        id: 'user-1',
        text: '从生物学角度介绍大模型推理',
        isUser: true,
        persistenceStatus: 'saved',
      },
      assistantMessageId: 'assistant-1',
      assistantFallback: {
        id: 'assistant-1',
        text: '这是完整的回答',
      },
      setDbConversationUUID: jest.fn(),
      finalizeStreamingMessage: jest.fn(),
      updateMessage: jest.fn(),
      saveMessage,
    });

    expect(saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-1',
        text: '这是完整的回答',
      }),
      'db-1'
    );
  });

  it('re-queries the db conversation id from the store conversation id when submit state missed it', async () => {
    mockGetChatStoreState.mockReturnValue({
      messages: [],
      currentConversationId: 'real-conv-1',
      currentTaskId: null,
    });
    mockResolveDbConversationUuidByExternalId.mockResolvedValue('db-2');

    const saveMessage = jest.fn().mockResolvedValue(true);
    const setDbConversationUUID = jest.fn();

    await persistChatMessagesAfterStreaming({
      finalDbConvUUID: null,
      dbConversationUUID: null,
      userMessage: {
        id: 'user-1',
        text: 'hist-full-20260328012921 只回答“好”，不要解释。',
        isUser: true,
        persistenceStatus: 'saved',
      },
      assistantMessageId: 'assistant-1',
      assistantFallback: {
        id: 'assistant-1',
        text: '好',
      },
      setDbConversationUUID,
      finalizeStreamingMessage: jest.fn(),
      updateMessage: jest.fn(),
      saveMessage,
    });

    expect(mockResolveDbConversationUuidByExternalId).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'real-conv-1',
        setDbConversationUUID,
      })
    );
    expect(saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-1',
        text: '好',
      }),
      'db-2'
    );
  });

  it('falls back to the current chat path to resolve the real conversation id', async () => {
    window.history.pushState({}, '', '/chat/real-conv-from-path');
    mockResolveDbConversationUuidByExternalId.mockResolvedValue('db-4');

    const saveMessage = jest.fn().mockResolvedValue(true);
    const setDbConversationUUID = jest.fn();

    await persistChatMessagesAfterStreaming({
      finalDbConvUUID: null,
      dbConversationUUID: null,
      userMessage: {
        id: 'user-1',
        text: 'path fallback',
        isUser: true,
        persistenceStatus: 'saved',
      },
      assistantMessageId: null,
      assistantFallback: {
        text: 'answer from fallback only',
      },
      setDbConversationUUID,
      finalizeStreamingMessage: jest.fn(),
      updateMessage: jest.fn(),
      saveMessage,
    });

    expect(mockResolveDbConversationUuidByExternalId).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'real-conv-from-path',
        setDbConversationUUID,
      })
    );
    expect(saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'answer from fallback only',
      }),
      'db-4'
    );
  });

  it('skips duplicate user persistence when the latest store message is already saved', async () => {
    mockGetChatStoreState.mockReturnValue({
      messages: [
        {
          id: 'user-1',
          text: 'hist-fix-20260328013558 只回答好',
          isUser: true,
          persistenceStatus: 'saved',
          db_id: 'db-msg-user-1',
        },
      ],
      currentConversationId: 'real-conv-2',
      currentTaskId: null,
    });

    const saveMessage = jest.fn().mockResolvedValue(true);

    await persistChatMessagesAfterStreaming({
      finalDbConvUUID: 'db-3',
      dbConversationUUID: null,
      userMessage: {
        id: 'user-1',
        text: 'hist-fix-20260328013558 只回答好',
        isUser: true,
        persistenceStatus: 'pending',
      },
      assistantMessageId: 'assistant-1',
      assistantFallback: {
        id: 'assistant-1',
        text: '好',
      },
      setDbConversationUUID: jest.fn(),
      finalizeStreamingMessage: jest.fn(),
      updateMessage: jest.fn(),
      saveMessage,
    });

    expect(mockPersistUserMessageIfNeeded).not.toHaveBeenCalled();
    expect(saveMessage).toHaveBeenCalledTimes(1);
    expect(saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-1',
        text: '好',
      }),
      'db-3'
    );
  });

  it('patches persisted user metadata when preview file ids arrive after the early save', async () => {
    const updateMessage = jest.fn();

    mockGetChatStoreState.mockReturnValue({
      messages: [
        {
          id: 'user-1',
          text: 'preview me',
          isUser: true,
          persistenceStatus: 'saved',
          db_id: 'db-msg-user-1',
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
      ],
      currentConversationId: 'real-conv-3',
      currentTaskId: null,
    });

    const saveMessage = jest.fn().mockResolvedValue(true);

    await persistChatMessagesAfterStreaming({
      finalDbConvUUID: 'db-3',
      dbConversationUUID: null,
      finalRealConvId: 'real-conv-3',
      userMessage: {
        id: 'user-1',
        text: 'preview me',
        isUser: true,
        persistenceStatus: 'pending',
      },
      userMessagePreviewFileIds: ['preview-file-1'],
      assistantMessageId: null,
      assistantFallback: null,
      setDbConversationUUID: jest.fn(),
      finalizeStreamingMessage: jest.fn(),
      updateMessage,
      saveMessage,
    });

    expect(updateMessage).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            upload_file_id: 'upload-file-1',
            preview_file_id: 'preview-file-1',
          }),
        ],
      })
    );
    expect(mockUpdateMessageMetadataRecord).toHaveBeenCalledWith({
      conversationId: 'db-3',
      messageId: 'db-msg-user-1',
      metadata: expect.objectContaining({
        attachments: [
          expect.objectContaining({
            preview_file_id: 'preview-file-1',
          }),
        ],
      }),
    });
    expect(mockPersistUserMessageIfNeeded).not.toHaveBeenCalled();
  });
});
