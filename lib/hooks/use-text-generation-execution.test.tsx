import { act, renderHook } from '@testing-library/react';

import { useTextGenerationExecution } from './use-text-generation-execution';

const mockCreateExecution = jest.fn();
const mockGetExecutionsByServiceInstance = jest.fn();
const mockUpdateExecutionStatus = jest.fn();
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
      await result.current.executeTextGeneration({ prompt: 'hello' });
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
});
