/** @jest-environment node */
import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import { saveFailedWorkflowExecutionData } from '@lib/hooks/use-workflow-execution/persistence';
import {
  updateCompleteExecutionData,
  updateExecutionStatus,
} from '@lib/services/client/app-executions-api';
import type { AppExecution } from '@lib/types/database';

jest.mock('@lib/hooks/use-combined-conversations', () => ({
  conversationEvents: {
    emit: jest.fn(),
  },
}));

jest.mock('@lib/services/client/app-executions-api', () => ({
  updateCompleteExecutionData: jest.fn(),
  updateExecutionStatus: jest.fn(),
}));

describe('saveFailedWorkflowExecutionData', () => {
  const mockedUpdateCompleteExecutionData = jest.mocked(
    updateCompleteExecutionData
  );
  const mockedUpdateExecutionStatus = jest.mocked(updateExecutionStatus);
  const mockedConversationEmit = jest.mocked(conversationEvents.emit);

  const streamResponse = {
    progressStream: (async function* () {
      return;
    })(),
    getWorkflowRunId: () => 'run-1',
    getTaskId: () => 'task-1',
    completionPromise: Promise.resolve({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: 'failed' as const,
      outputs: null,
      error: 'failed',
      elapsed_time: 1,
      total_tokens: 0,
      total_steps: 1,
      created_at: 1,
      finished_at: 2,
    }),
  };

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockedUpdateCompleteExecutionData.mockReset();
    mockedUpdateExecutionStatus.mockReset();
    mockedConversationEmit.mockReset();
  });

  it('persists detailed failed workflow metadata when the detailed save succeeds', async () => {
    const updateCurrentExecution = jest.fn();
    const updatedExecution = {
      id: 'exec-1',
      status: 'failed',
      error_message: 'friendly',
    } as Partial<AppExecution> as AppExecution;

    mockedUpdateCompleteExecutionData.mockResolvedValue({
      success: true,
      data: updatedExecution,
    });

    await saveFailedWorkflowExecutionData({
      currentExecutionId: 'exec-1',
      rawErrorMessage: 'raw',
      errorMessage: 'friendly',
      errorCode: 'REQUEST_FAILED',
      errorKind: 'request',
      suggestion: null,
      requestId: 'req-1',
      nodeExecutionData: [],
      streamResponse,
      instanceId: 'app-1',
      updateCurrentExecution,
    });

    expect(mockedUpdateCompleteExecutionData).toHaveBeenCalledTimes(1);
    expect(mockedUpdateCompleteExecutionData.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          error_details: expect.objectContaining({
            collected_node_data: [],
          }),
        }),
      })
    );
    expect(mockedUpdateExecutionStatus).not.toHaveBeenCalled();
    expect(updateCurrentExecution).toHaveBeenCalledWith(updatedExecution);
    expect(mockedConversationEmit).toHaveBeenCalledTimes(1);
  });

  it('falls back to compact metadata when detailed metadata persistence fails', async () => {
    const updateCurrentExecution = jest.fn();
    const compactExecution = {
      id: 'exec-compact',
      status: 'failed',
      error_message: 'friendly',
    } as Partial<AppExecution> as AppExecution;

    mockedUpdateCompleteExecutionData
      .mockResolvedValueOnce({
        success: false,
        error: new Error('detailed failed'),
      })
      .mockResolvedValueOnce({
        success: true,
        data: compactExecution,
      });

    await saveFailedWorkflowExecutionData({
      currentExecutionId: 'exec-compact',
      rawErrorMessage: 'raw',
      errorMessage: 'friendly',
      errorCode: 'REQUEST_FAILED',
      errorKind: 'request',
      suggestion: null,
      requestId: 'req-compact',
      nodeExecutionData: [
        {
          node_id: 'node-1',
          title: 'LLM',
          status: 'failed',
          event_type: 'node_finished',
          error: 'boom',
          total_tokens: 12,
          elapsed_time: 3,
        },
      ],
      streamResponse,
      instanceId: 'app-compact',
      updateCurrentExecution,
    });

    expect(mockedUpdateCompleteExecutionData).toHaveBeenCalledTimes(2);
    expect(mockedUpdateCompleteExecutionData.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          error_details: expect.objectContaining({
            total_node_count: 1,
            collected_node_summary: [
              expect.objectContaining({
                node_id: 'node-1',
                status: 'failed',
              }),
            ],
          }),
        }),
      })
    );
    expect(mockedUpdateExecutionStatus).not.toHaveBeenCalled();
    expect(updateCurrentExecution).toHaveBeenCalledWith(compactExecution);
    expect(mockedConversationEmit).toHaveBeenCalledTimes(1);
  });

  it('falls back to status-only persistence when detailed and compact saves both fail', async () => {
    const updateCurrentExecution = jest.fn();

    mockedUpdateCompleteExecutionData
      .mockResolvedValueOnce({
        success: false,
        error: new Error('detailed failed'),
      })
      .mockResolvedValueOnce({
        success: false,
        error: new Error('compact failed'),
      });
    mockedUpdateExecutionStatus.mockResolvedValue({
      success: true,
      data: true,
    });

    await saveFailedWorkflowExecutionData({
      currentExecutionId: 'exec-2',
      rawErrorMessage: 'raw',
      errorMessage: 'friendly',
      errorCode: 'REQUEST_FAILED',
      errorKind: 'request',
      suggestion: null,
      requestId: 'req-2',
      nodeExecutionData: [
        {
          node_id: 'node-1',
          title: 'LLM',
          status: 'failed',
          event_type: 'node_finished',
          error: 'boom',
        },
      ],
      streamResponse,
      instanceId: 'app-2',
      updateCurrentExecution,
    });

    expect(mockedUpdateCompleteExecutionData).toHaveBeenCalledTimes(2);
    expect(mockedUpdateExecutionStatus).toHaveBeenCalledWith(
      'exec-2',
      'failed',
      'friendly',
      expect.any(String)
    );
    expect(updateCurrentExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: 'friendly',
        completed_at: expect.any(String),
      })
    );
    expect(mockedConversationEmit).toHaveBeenCalledTimes(1);
  });
});
