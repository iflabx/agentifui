/** @jest-environment node */
import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import {
  determineTextGenerationFinalStatus,
  preparePersistedTextGenerationContent,
  saveCompleteTextGenerationData,
  saveStoppedTextGenerationData,
} from '@lib/hooks/use-text-generation-execution/persistence';
import {
  calculateTextGenerationProgress,
  countGeneratedWords,
} from '@lib/hooks/use-text-generation-execution/stream-helpers';
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

describe('text generation execution helpers', () => {
  it('prefers completed when generated text exists', () => {
    expect(
      determineTextGenerationFinalStatus(
        { error: 'upstream failed' },
        'hello world',
        null
      )
    ).toBe('completed');
  });

  it('falls back to failed when only error exists', () => {
    expect(
      determineTextGenerationFinalStatus({ error: 'upstream failed' }, '', null)
    ).toBe('failed');
  });

  it('uses message id when no text and no error exist', () => {
    expect(determineTextGenerationFinalStatus({}, '', 'msg-1')).toBe(
      'completed'
    );
    expect(determineTextGenerationFinalStatus({}, '', null)).toBe('failed');
  });

  it('caps text generation progress at 90', () => {
    expect(calculateTextGenerationProgress('a'.repeat(100))).toBe(10);
    expect(calculateTextGenerationProgress('a'.repeat(2000))).toBe(90);
  });

  it('counts generated words by whitespace groups', () => {
    expect(countGeneratedWords('hello   world\nnext line')).toBe(4);
    expect(countGeneratedWords('   ')).toBe(0);
  });

  it('extracts persistable main content from think-aware output', () => {
    const rawContent = '<think>internal reasoning</think>\n\nVisible answer';

    expect(preparePersistedTextGenerationContent(rawContent)).toEqual({
      storedText: 'Visible answer',
      rawTextLength: rawContent.length,
      storedTextLength: 14,
      hasReasoningBlocks: true,
    });
  });
});

describe('text generation persistence', () => {
  const mockedUpdateCompleteExecutionData = jest.mocked(
    updateCompleteExecutionData
  );
  const mockedUpdateExecutionStatus = jest.mocked(updateExecutionStatus);
  const mockedConversationEmit = jest.mocked(conversationEvents.emit);

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

  it('stores only visible text and removes duplicate text from metadata', async () => {
    const updateCurrentExecution = jest.fn();
    const addExecutionToHistory = jest.fn();
    const updatedExecution = {
      id: 'exec-1',
      status: 'completed',
      outputs: { generated_text: 'Visible answer' },
    } as Partial<AppExecution> as AppExecution;
    const rawContent = '<think>internal reasoning</think>\n\nVisible answer';

    mockedUpdateCompleteExecutionData.mockResolvedValue({
      success: true,
      data: updatedExecution,
    });

    const result = await saveCompleteTextGenerationData({
      executionId: 'exec-1',
      finalResult: {
        usage: { total_tokens: 12 },
      },
      taskId: 'task-1',
      messageId: 'msg-1',
      generatedText: rawContent,
      instanceId: 'app-1',
      updateCurrentExecution,
      addExecutionToHistory,
    });

    expect(result).toEqual({
      success: true,
      data: updatedExecution,
    });
    expect(mockedUpdateCompleteExecutionData).toHaveBeenCalledTimes(1);

    const persistedPayload =
      mockedUpdateCompleteExecutionData.mock.calls[0]?.[1];
    expect(persistedPayload?.outputs).toEqual({
      generated_text: 'Visible answer',
    });
    expect(
      (
        persistedPayload?.metadata as {
          generation_data?: Record<string, unknown>;
        }
      ).generation_data
    ).toEqual(
      expect.objectContaining({
        raw_text_length: rawContent.length,
        stored_text_length: 14,
        has_reasoning_blocks: true,
        has_content: true,
        content_storage: 'main-content-only',
      })
    );
    expect(
      (
        persistedPayload?.metadata as {
          generation_data?: Record<string, unknown>;
        }
      ).generation_data?.generated_text
    ).toBeUndefined();
    expect(updateCurrentExecution).toHaveBeenCalledWith(updatedExecution);
    expect(addExecutionToHistory).toHaveBeenCalledWith(updatedExecution);
    expect(mockedConversationEmit).toHaveBeenCalledTimes(1);
    expect(mockedUpdateExecutionStatus).not.toHaveBeenCalled();
  });

  it('retries complete save with compact metadata when detailed save fails', async () => {
    const updateCurrentExecution = jest.fn();
    const addExecutionToHistory = jest.fn();
    const updatedExecution = {
      id: 'exec-2',
      status: 'completed',
      outputs: { generated_text: 'Final answer' },
    } as Partial<AppExecution> as AppExecution;

    mockedUpdateCompleteExecutionData
      .mockResolvedValueOnce({
        success: false,
        error: new Error('detailed failed'),
      })
      .mockResolvedValueOnce({
        success: true,
        data: updatedExecution,
      });

    const result = await saveCompleteTextGenerationData({
      executionId: 'exec-2',
      finalResult: {
        usage: { total_tokens: 8 },
      },
      taskId: 'task-2',
      messageId: 'msg-2',
      generatedText: '<think>reasoning</think>\n\nFinal answer',
      instanceId: 'app-2',
      updateCurrentExecution,
      addExecutionToHistory,
    });

    expect(result).toEqual({
      success: true,
      data: updatedExecution,
    });
    expect(mockedUpdateCompleteExecutionData).toHaveBeenCalledTimes(2);
    expect(
      mockedUpdateCompleteExecutionData.mock.calls[1]?.[1].outputs
    ).toEqual({
      generated_text: 'Final answer',
    });
    expect(mockedUpdateExecutionStatus).not.toHaveBeenCalled();
  });

  it('marks execution failed when both complete-save attempts fail', async () => {
    const updateCurrentExecution = jest.fn();
    const addExecutionToHistory = jest.fn();

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

    const result = await saveCompleteTextGenerationData({
      executionId: 'exec-3',
      finalResult: {
        usage: { total_tokens: 6 },
      },
      taskId: 'task-3',
      messageId: 'msg-3',
      generatedText: '<think>reasoning</think>\n\nVisible answer',
      instanceId: 'app-3',
      updateCurrentExecution,
      addExecutionToHistory,
    });

    expect(result.success).toBe(false);
    expect(mockedUpdateCompleteExecutionData).toHaveBeenCalledTimes(2);
    expect(mockedUpdateExecutionStatus).toHaveBeenCalledWith(
      'exec-3',
      'failed',
      'Text generation output could not be fully persisted',
      expect.any(String)
    );
    expect(updateCurrentExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: 'Text generation output could not be fully persisted',
        completed_at: expect.any(String),
      })
    );
    expect(addExecutionToHistory).not.toHaveBeenCalled();
    expect(mockedConversationEmit).toHaveBeenCalledTimes(1);
  });

  it('strips think content before saving stopped text generation output', async () => {
    const updateCurrentExecution = jest.fn();
    const addExecutionToHistory = jest.fn();
    const updatedExecution = {
      id: 'exec-4',
      status: 'stopped',
      outputs: { generated_text: 'Visible answer' },
    } as Partial<AppExecution> as AppExecution;

    mockedUpdateCompleteExecutionData.mockResolvedValue({
      success: true,
      data: updatedExecution,
    });

    const result = await saveStoppedTextGenerationData({
      executionId: 'exec-4',
      taskId: 'task-4',
      generatedText: '<think>reasoning</think>\n\nVisible answer',
      instanceId: 'app-4',
      updateCurrentExecution,
      addExecutionToHistory,
    });

    expect(result).toEqual({
      success: true,
      data: updatedExecution,
    });
    expect(mockedUpdateCompleteExecutionData).toHaveBeenCalledWith(
      'exec-4',
      expect.objectContaining({
        outputs: { generated_text: 'Visible answer' },
      })
    );
  });
});
