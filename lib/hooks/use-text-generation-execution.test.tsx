import type { TaskExecutionReservation } from '@lib/services/client/app-executions-api';
import { definitiveTaskError } from '@lib/services/dify/submission';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import type { AppExecution } from '@lib/types/database';
import { act, renderHook } from '@testing-library/react';

import { useTextGenerationExecution } from './use-text-generation-execution';

const mockCreateExecution = jest.fn();
const mockGetExecutionsByServiceInstance = jest.fn();
const mockUpdateExecutionStatus = jest.fn();
const mockUpdateCompleteExecutionData = jest.fn();
const mockSaveCompleteTextGenerationData = jest.fn();
const mockSaveStoppedTextGenerationData = jest.fn();
const mockResolveTextGenerationTargetApp = jest.fn();
const mockStreamDifyCompletion = jest.fn();
const mockAddToFavorites = jest.fn();

jest.mock('@lib/hooks/use-profile', () => ({
  useProfile: () => ({
    profile: {
      id: 'user-1',
    },
  }),
}));

jest.mock('@lib/hooks/use-combined-conversations', () => ({
  conversationEvents: {
    emit: jest.fn(),
  },
}));

jest.mock('@lib/services/client/app-executions-api', () => ({
  createExecution: (...args: unknown[]) => mockCreateExecution(...args),
  getExecutionsByServiceInstance: (...args: unknown[]) =>
    mockGetExecutionsByServiceInstance(...args),
  updateExecutionStatus: (...args: unknown[]) =>
    mockUpdateExecutionStatus(...args),
  updateCompleteExecutionData: (...args: unknown[]) =>
    mockUpdateCompleteExecutionData(...args),
}));

jest.mock('./use-text-generation-execution/persistence', () => ({
  saveCompleteTextGenerationData: (...args: unknown[]) =>
    mockSaveCompleteTextGenerationData(...args),
  saveStoppedTextGenerationData: (...args: unknown[]) =>
    mockSaveStoppedTextGenerationData(...args),
}));

jest.mock('./use-text-generation-execution/app-instance', () => ({
  resolveTextGenerationTargetApp: (...args: unknown[]) =>
    mockResolveTextGenerationTargetApp(...args),
}));

jest.mock('@lib/services/dify/completion-service', () => ({
  streamDifyCompletion: (...args: unknown[]) =>
    mockStreamDifyCompletion(...args),
}));

jest.mock('@lib/stores/favorite-apps-store', () => ({
  useAutoAddFavoriteApp: () => ({
    addToFavorites: mockAddToFavorites,
  }),
}));

jest.mock('./use-date-formatter', () => ({
  useDateFormatter: () => ({
    formatDate: () => '2026-03-29 00:00',
  }),
}));

describe('useTextGenerationExecution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveCompleteTextGenerationData.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { useWorkflowExecutionStore } = jest.requireActual(
      '@lib/stores/workflow-execution-store'
    ) as typeof import('@lib/stores/workflow-execution-store');
    useWorkflowExecutionStore.getState().clearAll();

    mockResolveTextGenerationTargetApp.mockResolvedValue({
      id: 'service-1',
      instance_id: 'app-1',
    });
    mockCreateExecution.mockResolvedValue({
      success: true,
      data: {
        id: 'exec-1',
        service_instance_id: 'service-1',
        execution_type: 'text-generation',
        status: 'pending',
      },
    });
    mockUpdateExecutionStatus.mockResolvedValue({
      success: true,
      data: true,
    });
    mockGetExecutionsByServiceInstance.mockResolvedValue({
      success: true,
      data: [],
    });
    mockStreamDifyCompletion.mockResolvedValue({
      answerStream: (async function* () {
        yield 'Visible output';
      })(),
      completionPromise: Promise.resolve({ usage: { total_tokens: 5 } }),
      getTaskId: () => 'task-1',
      getMessageId: () => 'msg-1',
    });
    mockSaveStoppedTextGenerationData.mockResolvedValue({
      success: true,
      data: { id: 'exec-stopped', status: 'stopped' },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the locally tracked execution id when save failure happens after store currentExecution changes', async () => {
    const { useWorkflowExecutionStore } = jest.requireActual(
      '@lib/stores/workflow-execution-store'
    ) as typeof import('@lib/stores/workflow-execution-store');

    mockSaveCompleteTextGenerationData.mockImplementation(async () => {
      useWorkflowExecutionStore.getState().setCurrentExecution(null);
      return {
        success: false,
        error: new Error('persist failed'),
      };
    });

    const { result } = renderHook(() =>
      useTextGenerationExecution('instance-1')
    );

    await act(async () => {
      expect(
        await result.current.executeTextGeneration({ prompt: 'hello' })
      ).toBe(false);
    });

    expect(mockUpdateExecutionStatus).toHaveBeenNthCalledWith(
      1,
      'exec-1',
      'running'
    );
    expect(mockUpdateExecutionStatus).toHaveBeenNthCalledWith(
      2,
      'exec-1',
      'failed',
      expect.any(String),
      expect.any(String)
    );
  });

  describe('task terminal outcomes', () => {
    const reservation: TaskExecutionReservation = {
      submissionId: 'submission-1',
      execution: {
        id: 'exec-task',
        service_instance_id: 'service-1',
        execution_type: 'text-generation',
        status: 'pending',
        submission_id: 'submission-1',
        conversation_id: 'conversation-1',
        user_id: 'user-1',
      } as AppExecution,
    };

    beforeEach(() => {
      useChatInputStore.getState().setActor('user-1', 'session-1');
      const persistence = jest.requireActual(
        './use-text-generation-execution/persistence'
      ) as typeof import('./use-text-generation-execution/persistence');
      mockSaveCompleteTextGenerationData.mockImplementation(
        persistence.saveCompleteTextGenerationData
      );
      mockUpdateCompleteExecutionData.mockResolvedValue({
        success: false,
        error: new Error('result save unavailable'),
      });
    });

    it('keeps the reserved task running/unknown when both result saves fail', async () => {
      const { result } = renderHook(() =>
        useTextGenerationExecution('instance-1', true)
      );

      await act(async () => {
        expect(
          await result.current.executeTextGeneration(
            { prompt: 'hello' },
            reservation
          )
        ).toBe(false);
      });

      expect(mockSaveCompleteTextGenerationData).toHaveBeenCalledWith(
        expect.objectContaining({ preserveStatusOnSaveFailure: true })
      );
      expect(mockUpdateCompleteExecutionData).toHaveBeenCalledTimes(2);
      expect(mockUpdateExecutionStatus.mock.calls).toEqual([
        ['exec-task', 'running'],
      ]);
      expect(useWorkflowExecutionStore.getState()).toMatchObject({
        currentExecution: { id: 'exec-task', status: 'running' },
        error: 'TASK_OUTCOME_UNKNOWN',
        canRetry: false,
        isExecuting: false,
        formLocked: false,
        executionHistory: [],
      });
      expect(mockAddToFavorites).not.toHaveBeenCalled();
      expect(mockCreateExecution).not.toHaveBeenCalled();
      expect(mockStreamDifyCompletion).toHaveBeenCalledTimes(1);
    });

    it('does not save partial output as completed after a missing-terminal stream error', async () => {
      const error = new Error('Completion stream ended before message_end.');
      mockStreamDifyCompletion.mockResolvedValue({
        answerStream: (async function* () {
          yield 'Partial output';
          throw error;
        })(),
        completionPromise: Promise.resolve({}),
        getTaskId: () => 'task-1',
        getMessageId: () => 'msg-1',
      });
      const { result } = renderHook(() =>
        useTextGenerationExecution('instance-1', true)
      );

      await act(async () => {
        expect(
          await result.current.executeTextGeneration(
            { prompt: 'hello' },
            reservation
          )
        ).toBe(false);
      });

      expect(mockSaveCompleteTextGenerationData).not.toHaveBeenCalled();
      expect(mockUpdateExecutionStatus.mock.calls).toEqual([
        ['exec-task', 'running'],
      ]);
      expect(useWorkflowExecutionStore.getState()).toMatchObject({
        currentExecution: { id: 'exec-task', status: 'running' },
        error: 'TASK_OUTCOME_UNKNOWN',
        canRetry: false,
        isExecuting: false,
      });
    });

    it('still persists a definitive upstream failure as failed', async () => {
      mockStreamDifyCompletion.mockRejectedValue(
        definitiveTaskError(new Error('Upstream execution failed'), 'failed')
      );
      const { result } = renderHook(() =>
        useTextGenerationExecution('instance-1', true)
      );

      await act(async () => {
        expect(
          await result.current.executeTextGeneration(
            { prompt: 'hello' },
            reservation
          )
        ).toBe(false);
      });

      expect(mockUpdateExecutionStatus).toHaveBeenLastCalledWith(
        'exec-task',
        'failed',
        expect.any(String),
        expect.any(String)
      );
      expect(
        useWorkflowExecutionStore.getState().currentExecution?.status
      ).toBe('failed');
      expect(mockSaveCompleteTextGenerationData).not.toHaveBeenCalled();
    });
  });
});
