import { useChatInputRouteSync } from '@lib/hooks/use-chat-input-route-sync';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import { useCurrentAppStore } from '@lib/stores/current-app-store';
import { act, renderHook } from '@testing-library/react';

import { resolveChatSubmitAppConfig } from './app-config';
import { executeChatSubmit } from './submit-flow';
import { useChatSubmitHandler } from './submit-handler';

const mockSelectIsProcessing = jest.fn();
const mockGetChatStoreState = jest.fn();
const mockAcceptInput = jest.fn();
const mockCaptureInput = jest.fn();
let mockInputPath = '/apps/chatflow/app-1';

jest.mock('next/navigation', () => ({ usePathname: () => mockInputPath }));

jest.mock('@components/chat-input/submission', () => ({
  captureDifyInputSubmission: (...args: unknown[]) => mockCaptureInput(...args),
}));

jest.mock('@lib/stores/chat-store', () => ({
  selectIsProcessing: (...args: unknown[]) => mockSelectIsProcessing(...args),
  useChatStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector(mockGetChatStoreState()),
    { getState: (...args: unknown[]) => mockGetChatStoreState(...args) }
  ),
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
    preferredRouteAppId: null,
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
    moderationT: jest.fn((key: string) => key),
    incompleteAnswerMessage: '回答未完整生成，请重试。',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCaptureInput.mockReturnValue(mockAcceptInput);
    mockGetChatStoreState.mockReturnValue({
      messages: [],
      currentConversationId: null,
    });
    mockSelectIsProcessing.mockReturnValue(false);
    (resolveChatSubmitAppConfig as jest.Mock).mockResolvedValue({
      appId: 'app-1',
      instance: { id: 'instance-1' },
    });
    (executeChatSubmit as jest.Mock).mockResolvedValue({ ok: true });
    useCurrentAppStore.setState({ currentAppId: 'app-1' });
    useChatInputStore.getState().setActor('user-1');
    mockInputPath = '/apps/chatflow/app-1';
    useChatflowExecutionStore.getState().resetExecution();
  });

  it('binds execution ownership before adopting the exact temporary and real paths', async () => {
    const input = createInput();
    jest.mocked(executeChatSubmit).mockImplementationOnce(async submission => {
      expect(useChatflowExecutionStore.getState().view?.paths).toEqual([
        '/chat/new',
      ]);
      submission.viewScope?.onRouteAdopted('/chat/temp-owned');
      submission.viewScope?.onRouteAdopted('/chat/real-owned');
      return { ok: true };
    });
    const { result } = renderHook(() => useChatSubmitHandler(input));
    await act(async () => {
      await result.current('Question');
    });
    expect(useChatflowExecutionStore.getState().view).toMatchObject({
      actorId: 'user-1',
      appId: 'app-1',
      paths: ['/chat/new', '/chat/temp-owned', '/chat/real-owned'],
    });
  });

  it('detaches a same-path selected-app submission, including A-B-A without rerender', async () => {
    let resolveConfig!: (value: unknown) => void;
    jest.mocked(resolveChatSubmitAppConfig).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveConfig = resolve;
        }) as never
    );
    const input = { ...createInput(), conversationAppId: null };
    const { result } = renderHook(() => useChatSubmitHandler(input));
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current('A draft');
    });
    act(() => {
      useCurrentAppStore.setState({ currentAppId: 'app-2' });
      useCurrentAppStore.setState({ currentAppId: 'app-1' });
    });
    expect(input.isSubmittingRef.current).toBe(false);
    await act(async () => {
      resolveConfig({ appId: 'app-1', instance: { instance_id: 'app-1' } });
      await pending;
    });
    expect(executeChatSubmit).not.toHaveBeenCalled();
  });

  it('does not release B when A config rejects late', async () => {
    let finishA!: (value: null) => void;
    jest.mocked(resolveChatSubmitAppConfig).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishA = resolve;
        })
    );
    let finishB!: () => void;
    jest.mocked(executeChatSubmit).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishB = () => resolve({ ok: true });
        })
    );
    const input = { ...createInput(), conversationAppId: null };
    const { result } = renderHook(() => useChatSubmitHandler(input));
    let pendingA!: Promise<unknown>;
    act(() => {
      pendingA = result.current('A');
    });
    act(() => useCurrentAppStore.setState({ currentAppId: 'app-B' }));
    let pendingB!: Promise<unknown>;
    await act(async () => {
      pendingB = result.current('B');
      await Promise.resolve();
    });
    expect(input.isSubmittingRef.current).toBe(true);
    await act(async () => {
      finishA(null);
      await pendingA;
    });
    expect(input.isSubmittingRef.current).toBe(true);
    await act(async () => {
      finishB();
      await pendingB;
    });
    expect(input.isSubmittingRef.current).toBe(false);
  });

  it.each(['foreign', 'missing', 'old-actor', 'old-login'])(
    'rejects %s attachment provenance without consuming the draft',
    async provenance => {
      const input = createInput();
      const { result } = renderHook(() => useChatSubmitHandler(input));
      useChatInputStore.getState().setMessage('keep');
      await act(async () => {
        await result.current('keep', [
          {
            upload_file_id: 'uploaded-A',
            ...(provenance === 'foreign' ? { app_id: 'app-B' } : {}),
            ...(provenance === 'old-actor' || provenance === 'old-login'
              ? {
                  app_id: 'app-1',
                  actor_id: provenance === 'old-actor' ? 'user-2' : 'user-1',
                  actor_epoch:
                    useChatInputStore.getState().actorEpoch -
                    (provenance === 'old-login' ? 1 : 0),
                }
              : {}),
          },
        ]);
      });
      expect(resolveChatSubmitAppConfig).not.toHaveBeenCalled();
      expect(executeChatSubmit).not.toHaveBeenCalled();
      expect(useChatInputStore.getState().message).toBe('keep');
    }
  );

  it('invalidates a delayed configuration result when the user navigates away', async () => {
    let resolveConfig: (value: unknown) => void = () => undefined;
    jest.mocked(resolveChatSubmitAppConfig).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveConfig = resolve;
        }) as never
    );
    const input = createInput();
    const { result, rerender } = renderHook(
      ({ path }) => useChatSubmitHandler({ ...input, currentPathname: path }),
      { initialProps: { path: '/chat/new' } }
    );
    let pending: Promise<unknown>;
    act(() => {
      pending = result.current('Original');
    });
    rerender({ path: '/chat/other' });
    await act(async () => {
      resolveConfig({ appId: 'app-1', instance: { id: 'instance-1' } });
      await pending;
    });
    expect(executeChatSubmit).not.toHaveBeenCalled();
    expect(input.addMessage).not.toHaveBeenCalled();
  });

  it('keeps accepted temporary route adoption in scope but never reactivates a detached submission', async () => {
    const input = createInput();
    let captured: Parameters<typeof executeChatSubmit>[0] | undefined;
    jest.mocked(executeChatSubmit).mockImplementation(async value => {
      captured = value;
      return { ok: true };
    });
    const { result, rerender } = renderHook(
      ({ path }) => useChatSubmitHandler({ ...input, currentPathname: path }),
      { initialProps: { path: '/chat/new' } }
    );
    await act(async () => {
      await result.current('Original');
    });
    expect(captured?.viewScope?.isCurrent()).toBe(true);
    captured?.viewScope?.onRouteAdopted('/chat/real');
    rerender({ path: '/chat/real' });
    expect(captured?.viewScope?.isCurrent()).toBe(true);
    rerender({ path: '/chat/other' });
    expect(captured?.viewScope?.isCurrent()).toBe(false);
    rerender({ path: '/chat/real' });
    expect(captured?.viewScope?.isCurrent()).toBe(false);
  });

  it('keeps the form submission attached when a continuation input mounts on its temporary path', async () => {
    const input = {
      ...createInput(),
      preferredRouteAppId: 'app-1',
      currentPathname: mockInputPath,
    };
    const form = renderHook(() =>
      useChatInputRouteSync({ userId: 'user-1', appId: 'app-1' })
    );
    const source = form.result.current.scope;
    let finish!: () => void;
    let captured: Parameters<typeof executeChatSubmit>[0] | undefined;
    jest.mocked(executeChatSubmit).mockImplementation(async value => {
      captured = value;
      value.viewScope?.onRouteAdopted('/chat/temp-form');
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return { ok: true };
    });
    const submit = renderHook(() => useChatSubmitHandler(input));
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = submit.result.current('Question');
      await Promise.resolve();
    });
    mockInputPath = '/chat/temp-form';
    const continuation = renderHook(() =>
      useChatInputRouteSync({ userId: 'user-1', appId: 'app-1' })
    );
    try {
      expect(continuation.result.current.scope).toBe(source);
      expect(captured?.viewScope?.isCurrent()).toBe(true);
    } finally {
      await act(async () => {
        finish();
        await pending;
      });
    }
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
      await result.current(
        'hello',
        [
          {
            upload_file_id: 'file-1',
            app_id: 'app-1',
            actor_id: 'user-1',
            actor_epoch: useChatInputStore.getState().actorEpoch,
          },
        ],
        { foo: 'bar' }
      );
    });

    expect(resolveChatSubmitAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationAppId: 'app-1',
        preferredRouteAppId: null,
        ensureAppReady: input.ensureAppReady,
        validateConfig: input.validateConfig,
        onErrorMessage: expect.any(Function),
      })
    );
    expect(executeChatSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello',
        files: [
          {
            upload_file_id: 'file-1',
            app_id: 'app-1',
            actor_id: 'user-1',
            actor_epoch: useChatInputStore.getState().actorEpoch,
          },
        ],
        inputs: { foo: 'bar' },
        currentUserId: 'user-1',
        currentPathname: '/chat/new',
        difyConversationId: null,
        dbConversationUUID: null,
        setDifyConversationId: input.setDifyConversationId,
        setDbConversationUUID: input.setDbConversationUUID,
        setCurrentConversationId: input.setCurrentConversationId,
        setCurrentTaskId: expect.any(Function),
        navigateToConversation: input.navigateToConversation,
        flushChunkBuffer: input.flushChunkBuffer,
        chunkAppendInterval: 30,
        moderationT: input.moderationT,
        incompleteAnswerMessage: input.incompleteAnswerMessage,
      })
    );
    expect(mockCaptureInput).toHaveBeenCalledWith('hello', 'user-1', undefined);
    const submission = jest.mocked(executeChatSubmit).mock.calls[0][0];
    const binding = { externalId: 'external-A', taskId: 'task-A' };
    submission.onAccepted?.(binding);
    expect(mockAcceptInput).toHaveBeenCalledWith('app-1', binding);
  });
});
