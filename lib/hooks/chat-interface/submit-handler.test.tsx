import { act, renderHook } from '@testing-library/react';

import { useChatSubmitHandler } from './submit-handler';
import { resolveChatSubmitAppConfig } from './app-config';
import { executeChatSubmit } from './submit-flow';

const mockSelectIsProcessing = jest.fn();
const mockGetChatStoreState = jest.fn();

jest.mock('@lib/stores/chat-store', () => ({
  selectIsProcessing: (...args: unknown[]) => mockSelectIsProcessing(...args),
  useChatStore: {
    getState: (...args: unknown[]) => mockGetChatStoreState(...args),
  },
}));

jest.mock('./app-config', () => ({
  resolveChatSubmitAppConfig: jest.fn(),
}));

jest.mock('./submit-flow', () => ({
  executeChatSubmit: jest.fn(),
}));

describe('useChatSubmitHandler', () => {
  const createInput = (): Parameters<typeof useChatSubmitHandler>[0] => ({
    currentUserId: 'user-1',
    conversationAppId: 'app-1',
    ensureAppReady: jest.fn(),
    validateConfig: jest.fn(),
    addMessage: jest.fn(),
    setIsWaitingForResponse: jest.fn(),
    isWelcomeScreen: false,
    setIsWelcomeScreen: jest.fn(),
    finalizeStreamingMessage: jest.fn(),
    markAsManuallyStopped: jest.fn(),
    setMessageError: jest.fn(),
    setDifyConversationId: jest.fn(),
    setDbConversationUUID: jest.fn(),
    setCurrentConversationId: jest.fn(),
    setCurrentTaskId: jest.fn(),
    currentPathname: '/chat/new',
    difyConversationId: null,
    dbConversationUUID: null,
    onNodeEvent: jest.fn(),
    isSubmittingRef: { current: false },
    chunkBufferRef: { current: '' },
    appendTimerRef: { current: null },
    updateMessage: jest.fn(),
    updatePendingStatus: jest.fn(),
    saveMessage: jest.fn(),
    saveStoppedAssistantMessage: jest.fn(),
    saveErrorPlaceholder: jest.fn(),
    initiateNewConversation: jest.fn(),
    navigateToConversation: jest.fn(),
    flushChunkBuffer: jest.fn(),
    chunkAppendInterval: 30,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetChatStoreState.mockReturnValue({});
    mockSelectIsProcessing.mockReturnValue(false);
    (resolveChatSubmitAppConfig as jest.Mock).mockResolvedValue({
      appId: 'app-1',
      instance: { id: 'instance-1' },
    });
    (executeChatSubmit as jest.Mock).mockResolvedValue(undefined);
  });

  it('blocks submission while another submit is in progress', async () => {
    const input = createInput();
    input.isSubmittingRef.current = true;

    const { result } = renderHook(() => useChatSubmitHandler(input));

    await act(async () => {
      await result.current('hello');
    });

    expect(resolveChatSubmitAppConfig).not.toHaveBeenCalled();
    expect(executeChatSubmit).not.toHaveBeenCalled();
  });

  it('blocks submission when chat store is processing', async () => {
    mockSelectIsProcessing.mockReturnValue(true);
    const input = createInput();

    const { result } = renderHook(() => useChatSubmitHandler(input));

    await act(async () => {
      await result.current('hello');
    });

    expect(resolveChatSubmitAppConfig).not.toHaveBeenCalled();
    expect(executeChatSubmit).not.toHaveBeenCalled();
  });

  it('blocks submission for unauthenticated users', async () => {
    const input = createInput();
    input.currentUserId = undefined;

    const { result } = renderHook(() => useChatSubmitHandler(input));

    await act(async () => {
      await result.current('hello');
    });

    expect(resolveChatSubmitAppConfig).not.toHaveBeenCalled();
    expect(executeChatSubmit).not.toHaveBeenCalled();
  });

  it('delegates to executeChatSubmit with the resolved app config', async () => {
    const input = createInput();
    const { result } = renderHook(() => useChatSubmitHandler(input));

    await act(async () => {
      await result.current('hello', ['file-1'], { foo: 'bar' });
    });

    expect(resolveChatSubmitAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationAppId: 'app-1',
        ensureAppReady: input.ensureAppReady,
        validateConfig: input.validateConfig,
        onErrorMessage: expect.any(Function),
      })
    );
    expect(executeChatSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello',
        files: ['file-1'],
        inputs: { foo: 'bar' },
        currentUserId: 'user-1',
        currentPathname: '/chat/new',
        difyConversationId: null,
        dbConversationUUID: null,
        setDifyConversationId: input.setDifyConversationId,
        setDbConversationUUID: input.setDbConversationUUID,
        setCurrentConversationId: input.setCurrentConversationId,
        setCurrentTaskId: input.setCurrentTaskId,
        navigateToConversation: input.navigateToConversation,
        flushChunkBuffer: input.flushChunkBuffer,
        chunkAppendInterval: 30,
      })
    );
  });
});
