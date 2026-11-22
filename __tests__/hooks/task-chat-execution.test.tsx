import { useTextGenerationExecution } from '@lib/hooks/use-text-generation-execution';
import { useWorkflowExecution } from '@lib/hooks/use-workflow-execution';
import type { TaskExecutionReservation } from '@lib/services/client/app-executions-api';
import { definitiveTaskError } from '@lib/services/dify/submission';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import type { AppExecution } from '@lib/types/database';
import { act, renderHook, waitFor } from '@testing-library/react';
import { deserialize, serialize } from 'node:v8';

const mockCreateExecution = jest.fn();
const mockUpdateExecutionStatus = jest.fn();
const mockGetHistory = jest.fn();
const mockStreamWorkflow = jest.fn();
const mockStreamCompletion = jest.fn();
const mockSaveWorkflow = jest.fn();
const mockSaveFailedWorkflow = jest.fn();
const mockSaveCompletion = jest.fn();
const mockSaveStoppedCompletion = jest.fn();
const mockAddFavorite = jest.fn();
const mockFormatDate = jest.fn(() => '2026-11-22');
const mockResolveApp = jest.fn();
const mockProfile = { id: 'actor-a', role: 'admin' };
const originalStructuredClone = Object.getOwnPropertyDescriptor(
  globalThis,
  'structuredClone'
);

beforeAll(() => {
  if (!globalThis.structuredClone) {
    Object.defineProperty(globalThis, 'structuredClone', {
      configurable: true,
      value: (value: unknown) => deserialize(serialize(value)),
    });
  }
});

afterAll(() => {
  if (originalStructuredClone) {
    Object.defineProperty(
      globalThis,
      'structuredClone',
      originalStructuredClone
    );
  } else {
    Reflect.deleteProperty(globalThis, 'structuredClone');
  }
});

jest.mock('@lib/hooks/use-profile', () => ({
  useProfile: () => ({ profile: mockProfile }),
}));
jest.mock('@lib/hooks/use-combined-conversations', () => ({
  conversationEvents: { emit: jest.fn() },
}));
jest.mock('@lib/hooks/use-date-formatter', () => ({
  useDateFormatter: () => ({ formatDate: mockFormatDate }),
}));
jest.mock('@lib/stores/favorite-apps-store', () => ({
  useAutoAddFavoriteApp: () => ({ addToFavorites: mockAddFavorite }),
}));
jest.mock('@lib/services/client/app-executions-api', () => ({
  createExecution: (...args: unknown[]) => mockCreateExecution(...args),
  updateExecutionStatus: (...args: unknown[]) =>
    mockUpdateExecutionStatus(...args),
  getExecutionsByServiceInstance: (...args: unknown[]) =>
    mockGetHistory(...args),
}));
jest.mock('@lib/hooks/use-workflow-execution/app-instance', () => ({
  resolveWorkflowTargetApp: (...args: unknown[]) => mockResolveApp(...args),
}));
jest.mock('@lib/hooks/use-text-generation-execution/app-instance', () => ({
  resolveTextGenerationTargetApp: (...args: unknown[]) =>
    mockResolveApp(...args),
}));
jest.mock('@lib/services/dify/workflow-service', () => ({
  streamDifyWorkflow: (...args: unknown[]) => mockStreamWorkflow(...args),
}));
jest.mock('@lib/services/dify/completion-service', () => ({
  streamDifyCompletion: (...args: unknown[]) => mockStreamCompletion(...args),
}));
jest.mock('@lib/hooks/use-workflow-execution/persistence', () => ({
  saveCompleteWorkflowExecutionData: (...args: unknown[]) =>
    mockSaveWorkflow(...args),
  saveFailedWorkflowExecutionData: (...args: unknown[]) =>
    mockSaveFailedWorkflow(...args),
}));
jest.mock('@lib/hooks/use-text-generation-execution/persistence', () => ({
  saveCompleteTextGenerationData: (...args: unknown[]) =>
    mockSaveCompletion(...args),
  saveStoppedTextGenerationData: (...args: unknown[]) =>
    mockSaveStoppedCompletion(...args),
}));

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}

function execution(
  type: AppExecution['execution_type'],
  id = 'execution-a'
): AppExecution {
  return {
    id,
    user_id: 'actor-a',
    service_instance_id: 'app-uuid',
    conversation_id: 'conversation-a',
    submission_id: 'submission-a',
    execution_type: type,
    external_execution_id: null,
    task_id: null,
    title: 'Reserved task',
    inputs: { prompt: 'hello' },
    outputs: null,
    status: 'pending',
    error_message: null,
    total_steps: 0,
    total_tokens: 0,
    elapsed_time: null,
    metadata: {},
    created_at: '2026-11-22T00:00:00Z',
    updated_at: '2026-11-22T00:00:00Z',
    completed_at: null,
  };
}

type SaveCallbacks = {
  updateCurrentExecution: (updates: Partial<AppExecution>) => void;
  addExecutionToHistory: (saved: AppExecution) => void;
};

const variants = [
  {
    type: 'workflow' as const,
    useTask: (instanceId: string) => {
      const hook = useWorkflowExecution(instanceId, true);
      return { execute: hook.executeWorkflow };
    },
    stream: mockStreamWorkflow,
    save: mockSaveWorkflow,
  },
  {
    type: 'text-generation' as const,
    useTask: (instanceId: string) => {
      const hook = useTextGenerationExecution(instanceId, true);
      return { execute: hook.executeTextGeneration };
    },
    stream: mockStreamCompletion,
    save: mockSaveCompletion,
  },
];

describe.each(variants)(
  '$type task-chat execution hook',
  ({ type, useTask, stream, save }) => {
    let reservation: TaskExecutionReservation;

    beforeEach(() => {
      jest.resetAllMocks();
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      useWorkflowExecutionStore.getState().clearAll();
      useChatInputStore.getState().setActor('actor-a', 'session-a');
      reservation = {
        execution: execution(type),
        submissionId: 'submission-a',
      };
      mockResolveApp.mockResolvedValue({
        id: 'app-uuid',
        instance_id: 'app-route',
      });
      mockUpdateExecutionStatus.mockResolvedValue({
        success: true,
        data: true,
      });
      mockSaveFailedWorkflow.mockResolvedValue({ success: true });
      mockGetHistory.mockResolvedValue({ success: true, data: [] });
      mockFormatDate.mockReturnValue('2026-11-22');
      stream.mockImplementation(async () => ({
        progressStream: (async function* () {
          yield* [];
        })(),
        answerStream: (async function* () {
          yield 'answer-a';
        })(),
        completionPromise: Promise.resolve({
          outputs: { answer: 'answer-a' },
          usage: { total_tokens: 3 },
        }),
        getTaskId: () => 'task-a',
        getWorkflowRunId: () => 'run-a',
        getMessageId: () => 'message-a',
      }));
      save.mockImplementation(async (callbacks: SaveCallbacks) => {
        const saved = {
          ...reservation.execution,
          status: 'completed' as const,
        };
        callbacks.updateCurrentExecution(saved);
        callbacks.addExecutionToHistory(saved);
        return { success: true, data: saved };
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('reuses the reserved execution and forwards the same submission ID', async () => {
      const { result } = renderHook(() => useTask('app-route'));
      await act(async () => {
        expect(
          await result.current.execute({ prompt: 'hello' }, reservation)
        ).toBe(true);
      });

      expect(mockCreateExecution).not.toHaveBeenCalled();
      expect(mockGetHistory).not.toHaveBeenCalled();
      expect(mockUpdateExecutionStatus).toHaveBeenCalledWith(
        'execution-a',
        'running'
      );
      const payload = expect.objectContaining({
        inputs: { prompt: 'hello' },
        user: 'actor-a',
      });
      if (type === 'workflow') {
        expect(stream).toHaveBeenCalledWith(payload, 'app-route', undefined, {
          submissionId: 'submission-a',
        });
      } else {
        expect(stream).toHaveBeenCalledWith('app-route', payload, {
          submissionId: 'submission-a',
        });
      }
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ executionId: 'execution-a' })
      );
      expect(useWorkflowExecutionStore.getState()).toMatchObject({
        currentExecution: { id: 'execution-a', status: 'completed' },
        executionHistory: [expect.objectContaining({ id: 'execution-a' })],
        isExecuting: false,
      });
    });

    it.each([
      'unmount',
      'navigation',
      'actor change',
      'actor epoch change',
      'execution replacement',
    ] as const)(
      'ignores deferred completion-save callbacks after %s without overwriting or stopping B',
      async transition => {
        const pendingSave = deferred<{ success: true; data: AppExecution }>();
        save.mockReturnValue(pendingSave.promise);
        const { result, rerender, unmount } = renderHook(
          ({ instanceId }) => useTask(instanceId),
          { initialProps: { instanceId: 'app-route' } }
        );
        let running!: Promise<boolean>;
        act(() => {
          running = result.current.execute({ prompt: 'hello' }, reservation);
        });
        await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        const callbacks = save.mock.calls[0][0] as SaveCallbacks;

        if (transition === 'unmount') unmount();
        if (transition === 'navigation')
          rerender({ instanceId: 'app-route-b' });
        act(() => {
          if (transition === 'actor change')
            useChatInputStore.getState().setActor('actor-b', 'session-b');
          if (transition === 'actor epoch change') {
            useChatInputStore.getState().setActor('actor-b', 'session-b');
            useChatInputStore.getState().setActor('actor-a', 'session-a-new');
          }
          const state = useWorkflowExecutionStore.getState();
          state.startExecution({ prompt: 'B is running' });
          state.setCurrentExecution({
            ...execution(type, 'execution-b'),
            status: 'running',
          });
          state.setExecutionProgress(42);
        });
        const beforeLateCallback = useWorkflowExecutionStore.getState();
        await act(async () => {
          const saved = {
            ...reservation.execution,
            status: 'completed' as const,
          };
          callbacks.updateCurrentExecution(saved);
          callbacks.addExecutionToHistory(saved);
          pendingSave.resolve({ success: true, data: saved });
          expect(await running).toBe(false);
        });

        expect(useWorkflowExecutionStore.getState()).toBe(beforeLateCallback);
        expect(useWorkflowExecutionStore.getState()).toMatchObject({
          currentExecution: { id: 'execution-b', status: 'running' },
          isExecuting: true,
          formLocked: true,
          executionProgress: 42,
          executionHistory: [],
        });
        expect(mockAddFavorite).not.toHaveBeenCalled();
        expect(mockCreateExecution).not.toHaveBeenCalled();
      }
    );

    it('marks a dispatch rejection without a response unknown, without persisting failure or retrying', async () => {
      stream.mockRejectedValue(
        new TypeError('Network connection lost after dispatch')
      );
      const { result } = renderHook(() => useTask('app-route'));
      await act(async () => {
        expect(
          await result.current.execute({ prompt: 'hello' }, reservation)
        ).toBe(false);
      });

      expect(useWorkflowExecutionStore.getState()).toMatchObject({
        error: 'TASK_OUTCOME_UNKNOWN',
        canRetry: false,
        isExecuting: false,
        formLocked: false,
        currentExecution: { id: 'execution-a', status: 'running' },
      });
      expect(mockUpdateExecutionStatus.mock.calls).toEqual([
        ['execution-a', 'running'],
      ]);
      expect(mockSaveFailedWorkflow).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(mockSaveStoppedCompletion).not.toHaveBeenCalled();
      expect(mockCreateExecution).not.toHaveBeenCalled();
      expect(stream).toHaveBeenCalledTimes(1);
    });

    it.each(['refused', 'failed'] as const)(
      'persists an explicitly tagged definitive %s error',
      async outcome => {
        stream.mockRejectedValue(
          definitiveTaskError(
            new Error('Definitive upstream rejection'),
            outcome
          )
        );
        const { result } = renderHook(() => useTask('app-route'));
        await act(async () => {
          expect(
            await result.current.execute({ prompt: 'hello' }, reservation)
          ).toBe(false);
        });

        expect(useWorkflowExecutionStore.getState().error).not.toBe(
          'TASK_OUTCOME_UNKNOWN'
        );
        expect(useWorkflowExecutionStore.getState().error).toEqual(
          expect.any(String)
        );
        if (type === 'workflow') {
          expect(mockSaveFailedWorkflow).toHaveBeenCalledWith(
            expect.objectContaining({
              currentExecutionId: 'execution-a',
              rawErrorMessage: 'Definitive upstream rejection',
            })
          );
        } else {
          expect(mockUpdateExecutionStatus).toHaveBeenCalledWith(
            'execution-a',
            'failed',
            expect.any(String),
            expect.any(String)
          );
          expect(
            useWorkflowExecutionStore.getState().currentExecution?.status
          ).toBe('failed');
        }
        expect(save).not.toHaveBeenCalled();
        expect(mockCreateExecution).not.toHaveBeenCalled();
        expect(stream).toHaveBeenCalledTimes(1);
      }
    );
  }
);
