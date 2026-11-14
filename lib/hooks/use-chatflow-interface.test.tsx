import {
  chatInputScope,
  useChatInputStore,
} from '@lib/stores/chat-input-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import { useCurrentAppStore } from '@lib/stores/current-app-store';
import { act, renderHook } from '@testing-library/react';

import { useChatflowInterface } from './use-chatflow-interface';

let mockPathname = '/apps/chatflow/app-B';
const mockSubmit = jest.fn();
const mockStop = jest.fn();
const mockSession = { session: { user: { id: 'actor' } }, loading: false };

jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => mockSession,
}));
jest.mock('./use-chat-interface', () => ({
  useChatInterface: () => ({
    handleSubmit: mockSubmit,
    handleStopProcessing: mockStop,
    isWaitingForResponse: false,
    conversationAppId: null,
  }),
}));

function startTask() {
  useChatflowExecutionStore.getState().startExecution();
  useChatflowExecutionStore.getState().addNode({
    id: 'node-A',
    title: 'A',
    status: 'running',
    iterations: [
      { id: 'iteration-A', index: 0, startTime: 1, status: 'running' },
    ],
    parallelBranches: [
      { id: 'branch-A', index: 0, startTime: 1, status: 'running' },
    ],
  });
  useChatStore.setState({ currentTaskId: 'task-A' });
}

describe('Chatflow form and stop ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = '/apps/chatflow/app-B';
    mockSession.loading = false;
    useChatInputStore.getState().setActor(null);
    useChatInputStore.getState().setActor('actor');
    const input = useChatInputStore.getState();
    input.setCurrentRoute(
      chatInputScope(input.actorEpoch, 'actor', 'app-A', 'draft-A')
    );
    useCurrentAppStore.setState({ currentAppId: 'app-B' });
    useChatflowExecutionStore.getState().resetExecution();
    useChatStore.setState({ currentTaskId: null });
    mockSubmit.mockResolvedValue({ ok: true });
    mockStop.mockResolvedValue({
      confirmed: false,
      current: true,
      taskId: 'task-A',
    });
  });

  it('establishes B form scope before a first submission without ChatInput mounted', async () => {
    mockSubmit.mockImplementation(async () => {
      const input = useChatInputStore.getState();
      expect(JSON.parse(input.currentRoute).slice(0, 3)).toEqual([
        input.actorEpoch,
        'actor',
        'app-B',
      ]);
      return { ok: true };
    });
    const { result } = renderHook(() => useChatflowInterface('app-B'));
    await act(async () => {
      await result.current.handleChatflowSubmit('B', {});
    });
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('keeps validated form upload provenance through Dify formatting', async () => {
    const { result } = renderHook(() => useChatflowInterface('app-B'));
    const file = {
      type: 'document',
      upload_file_id: 'upload-B',
      app_id: 'app-B',
      actor_id: 'actor',
      actor_epoch: useChatInputStore.getState().actorEpoch,
    };
    await act(async () => {
      await result.current.handleChatflowSubmit('B', { document: file }, [
        file,
      ]);
    });
    expect(mockSubmit).toHaveBeenCalledWith(
      'B',
      [expect.objectContaining(file)],
      { document: file }
    );
  });

  it.each(['app', 'actor', 'epoch', 'missing'])(
    'rejects a form upload with foreign or missing %s provenance before starting tracking',
    async kind => {
      const { result } = renderHook(() => useChatflowInterface('app-B'));
      const file: Record<string, unknown> = {
        upload_file_id: 'upload-B',
        app_id: 'app-B',
        actor_id: 'actor',
        actor_epoch: useChatInputStore.getState().actorEpoch,
      };
      if (kind === 'app') file.app_id = 'app-A';
      if (kind === 'actor') file.actor_id = 'other';
      if (kind === 'epoch') file.actor_epoch = -1;
      if (kind === 'missing') delete file.actor_epoch;
      await act(async () => {
        await result.current.handleChatflowSubmit('B', { document: file }, [
          file,
        ]);
      });
      expect(mockSubmit).not.toHaveBeenCalled();
      expect(useChatflowExecutionStore.getState().isExecuting).toBe(false);
    }
  );

  it('rejects invalid uploads embedded in inputs even when omitted from files', async () => {
    const { result } = renderHook(() => useChatflowInterface('app-B'));
    await act(async () => {
      await result.current.handleChatflowSubmit('B', {
        document: { upload_file_id: 'foreign-upload', app_id: 'app-A' },
      });
    });
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('does not run a stale form submit or stop callback after a view round trip', async () => {
    const { result, rerender } = renderHook(() =>
      useChatflowInterface('app-B')
    );
    const stale = result.current;
    mockPathname = '/apps/chatflow/app-C';
    rerender();
    mockPathname = '/apps/chatflow/app-B';
    rerender();
    act(startTask);
    await act(async () => {
      await stale.handleChatflowSubmit('old B', {});
      expect(await stale.handleStopProcessing()).toEqual({
        confirmed: false,
        current: false,
        taskId: 'task-A',
      });
    });
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('does not put an old form submission error onto a replacement view', async () => {
    let rejectSubmit!: (error: Error) => void;
    mockSubmit.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectSubmit = reject;
        })
    );
    const { result, rerender } = renderHook(() =>
      useChatflowInterface('app-B')
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current
        .handleChatflowSubmit('B', {})
        .catch(() => undefined);
    });
    mockPathname = '/apps/chatflow/app-C';
    rerender();
    act(startTask);
    await act(async () => {
      rejectSubmit(new Error('old error'));
      await pending;
    });
    expect(useChatflowExecutionStore.getState().error).toBeNull();
  });

  it.each(['failure', 'preacceptance', 'duplicate', 'unknown'])(
    'does not stop node tracking for an unconfirmed stop: %s',
    async () => {
      const { result } = renderHook(() => useChatflowInterface('app-B'));
      act(startTask);
      await act(async () => {
        await result.current.handleStopProcessing();
      });
      expect(useChatflowExecutionStore.getState().isExecuting).toBe(true);
      expect(useChatflowExecutionStore.getState().nodes[0].status).toBe(
        'running'
      );
    }
  );

  it('does not stop node tracking when the underlying stop throws', async () => {
    mockStop.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useChatflowInterface('app-B'));
    act(startTask);
    await act(async () => {
      await expect(result.current.handleStopProcessing()).rejects.toThrow(
        'offline'
      );
    });
    expect(useChatflowExecutionStore.getState().isExecuting).toBe(true);
  });

  it('finishes the same execution only after confirmed task cancellation', async () => {
    mockStop.mockImplementation(async () => {
      useChatStore.setState({ currentTaskId: null });
      return { confirmed: true, current: true, taskId: 'task-A' };
    });
    const { result } = renderHook(() => useChatflowInterface('app-B'));
    act(startTask);
    await act(async () => {
      await result.current.handleStopProcessing();
    });
    const execution = useChatflowExecutionStore.getState();
    expect(execution.isExecuting).toBe(false);
    expect(execution.nodes[0].status).toBe('failed');
    expect(execution.nodes[0].iterations?.[0].status).toBe('failed');
    expect(execution.nodes[0].parallelBranches?.[0].status).toBe('failed');
  });

  it.each(['execution', 'task', 'task-clear', 'view', 'actor', 'unmount'])(
    'never finalizes B after a delayed A stop changes %s',
    async change => {
      let resolveStop!: (result: {
        confirmed: boolean;
        current: boolean;
        taskId: string;
      }) => void;
      mockStop.mockImplementation(
        () =>
          new Promise(resolve => {
            resolveStop = resolve;
          })
      );
      const { result, rerender, unmount } = renderHook(() =>
        useChatflowInterface('app-B')
      );
      act(startTask);
      let pending!: ReturnType<typeof result.current.handleStopProcessing>;
      act(() => {
        pending = result.current.handleStopProcessing();
      });
      act(() => {
        if (change === 'execution') {
          useChatflowExecutionStore.getState().resetExecution();
          startTask();
        }
        if (change === 'task') {
          useChatStore.setState({ currentTaskId: 'task-B' });
          useChatStore.setState({ currentTaskId: 'task-A' });
        }
        if (change === 'task-clear') {
          useChatStore.setState({ currentTaskId: null });
          useChatStore.setState({ currentTaskId: 'task-A' });
        }
        if (change === 'actor') {
          useChatInputStore.getState().setActor(null);
          useChatInputStore.getState().setActor('actor');
        }
      });
      if (change === 'view') {
        mockPathname = '/apps/chatflow/app-C';
        rerender();
        mockPathname = '/apps/chatflow/app-B';
        rerender();
      }
      if (change === 'unmount') unmount();
      await act(async () => {
        resolveStop({ confirmed: true, current: true, taskId: 'task-A' });
        await pending;
      });
      expect(useChatflowExecutionStore.getState().isExecuting).toBe(true);
      expect(useChatflowExecutionStore.getState().nodes[0].status).toBe(
        'running'
      );
    }
  );
});
