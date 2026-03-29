import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import { toUserFacingAgentError } from '@lib/services/agent-error/user-facing-error';
import {
  updateCompleteExecutionData,
  updateExecutionStatus,
} from '@lib/services/client/app-executions-api';
import type { AppExecution, ExecutionStatus } from '@lib/types/database';
import type { Result } from '@lib/types/result';
import {
  extractMainTextFromThinkAwareContent,
  hasThinkAwareContent,
} from '@lib/utils';

import { countGeneratedWords } from './stream-helpers';
import type { CompletionFinalResult } from './types';

type TextGenerationExecutionUpdater = (updates: Partial<AppExecution>) => void;

type SaveCompleteTextGenerationDataParams = {
  executionId: string;
  finalResult: CompletionFinalResult;
  taskId: string | null;
  messageId: string | null;
  generatedText: string;
  instanceId: string;
  updateCurrentExecution: TextGenerationExecutionUpdater;
  addExecutionToHistory: (execution: AppExecution) => void;
};

type SaveStoppedTextGenerationDataParams = {
  executionId: string;
  taskId: string | null;
  generatedText: string;
  instanceId: string;
  updateCurrentExecution: TextGenerationExecutionUpdater;
  addExecutionToHistory: (execution: AppExecution) => void;
};

type PersistedTextGenerationContent = {
  storedText: string;
  rawTextLength: number;
  storedTextLength: number;
  hasReasoningBlocks: boolean;
};

const TEXT_GENERATION_PERSISTENCE_FAILURE_MESSAGE =
  'Text generation output could not be fully persisted';

function getTextGenerationLocale(): string {
  return typeof navigator !== 'undefined' ? navigator.language : 'en-US';
}

function getTextGenerationUserAgent(): string | null {
  return typeof window !== 'undefined' ? window.navigator.userAgent : null;
}

export function preparePersistedTextGenerationContent(
  generatedText: string
): PersistedTextGenerationContent {
  const storedText = extractMainTextFromThinkAwareContent(generatedText);

  return {
    storedText,
    rawTextLength: generatedText.length,
    storedTextLength: storedText.length,
    hasReasoningBlocks: hasThinkAwareContent(generatedText),
  };
}

export function determineTextGenerationFinalStatus(
  finalResult: CompletionFinalResult,
  generatedText: string,
  messageId: string | null
): ExecutionStatus {
  if (generatedText.length > 0) {
    console.log(
      '[Text Generation] Detected generated content, status set to completed'
    );
    return 'completed';
  }

  if (finalResult.error) {
    console.log('[Text Generation] Detected error info, status set to failed');
    return 'failed';
  }

  const status = messageId ? 'completed' : 'failed';
  console.log('[Text Generation] Status determined by messageId:', status);
  return status;
}

function buildCompleteTextGenerationMetadata(
  finalResult: CompletionFinalResult,
  messageId: string | null,
  persistedContent: PersistedTextGenerationContent,
  instanceId: string,
  finalStatus: ExecutionStatus,
  completedAt: string,
  normalizedFinalError: ReturnType<typeof toUserFacingAgentError> | null,
  finalRawError: string | null
): Record<string, unknown> {
  return {
    dify_response: {
      message_id: messageId,
      created_at: finalResult.created_at || null,
      conversation_id: finalResult.conversation_id || null,
    },
    generation_data: {
      raw_text_length: persistedContent.rawTextLength,
      stored_text_length: persistedContent.storedTextLength,
      word_count: countGeneratedWords(persistedContent.storedText),
      has_content: persistedContent.storedTextLength > 0,
      has_reasoning_blocks: persistedContent.hasReasoningBlocks,
      content_storage: 'main-content-only',
    },
    execution_context: {
      user_agent: getTextGenerationUserAgent(),
      timestamp: new Date().toISOString(),
      instance_id: instanceId,
      execution_mode: 'streaming',
      api_type: 'completion',
      final_status: finalStatus,
    },
    ...(finalRawError && {
      error_details: {
        message: normalizedFinalError?.userMessage || finalRawError,
        raw_message: finalRawError,
        code: normalizedFinalError?.code || null,
        kind: normalizedFinalError?.kind || null,
        suggestion: normalizedFinalError?.suggestion || null,
        timestamp: completedAt,
      },
    }),
    ...(normalizedFinalError && {
      agent_error: {
        code: normalizedFinalError.code,
        kind: normalizedFinalError.kind,
        source: normalizedFinalError.source,
        retryable: normalizedFinalError.retryable,
        suggestion: normalizedFinalError.suggestion,
        raw_message: normalizedFinalError.rawMessage,
      },
    }),
  };
}

function buildCompactCompleteTextGenerationMetadata(
  messageId: string | null,
  persistedContent: PersistedTextGenerationContent,
  instanceId: string,
  finalStatus: ExecutionStatus
): Record<string, unknown> {
  return {
    dify_response: {
      message_id: messageId,
    },
    generation_data: {
      raw_text_length: persistedContent.rawTextLength,
      stored_text_length: persistedContent.storedTextLength,
      has_content: persistedContent.storedTextLength > 0,
      has_reasoning_blocks: persistedContent.hasReasoningBlocks,
      content_storage: 'main-content-only',
    },
    execution_context: {
      user_agent: getTextGenerationUserAgent(),
      timestamp: new Date().toISOString(),
      instance_id: instanceId,
      execution_mode: 'streaming',
      api_type: 'completion',
      final_status: finalStatus,
    },
  };
}

function buildStoppedTextGenerationMetadata(
  persistedContent: PersistedTextGenerationContent,
  taskId: string | null,
  instanceId: string
): Record<string, unknown> {
  return {
    dify_response: {
      message_id: null,
      task_id: taskId,
      stopped_by_user: true,
    },
    generation_data: {
      raw_text_length: persistedContent.rawTextLength,
      stored_text_length: persistedContent.storedTextLength,
      word_count: countGeneratedWords(persistedContent.storedText),
      has_content: persistedContent.storedTextLength > 0,
      has_reasoning_blocks: persistedContent.hasReasoningBlocks,
      is_partial: true,
      content_storage: 'main-content-only',
    },
    execution_context: {
      user_agent: getTextGenerationUserAgent(),
      timestamp: new Date().toISOString(),
      instance_id: instanceId,
      execution_mode: 'streaming',
      api_type: 'completion',
      final_status: 'stopped',
      stop_reason: 'user_manual',
    },
  };
}

function buildCompactStoppedTextGenerationMetadata(
  persistedContent: PersistedTextGenerationContent,
  taskId: string | null,
  instanceId: string
): Record<string, unknown> {
  return {
    dify_response: {
      task_id: taskId,
      stopped_by_user: true,
    },
    generation_data: {
      raw_text_length: persistedContent.rawTextLength,
      stored_text_length: persistedContent.storedTextLength,
      has_content: persistedContent.storedTextLength > 0,
      has_reasoning_blocks: persistedContent.hasReasoningBlocks,
      is_partial: true,
      content_storage: 'main-content-only',
    },
    execution_context: {
      instance_id: instanceId,
      execution_mode: 'streaming',
      api_type: 'completion',
      final_status: 'stopped',
    },
  };
}

async function persistTextGenerationUpdate(
  executionId: string,
  completeData: {
    status: ExecutionStatus;
    external_execution_id?: string | null;
    task_id?: string | null;
    outputs?: Record<string, unknown> | null;
    total_steps?: number;
    total_tokens?: number;
    elapsed_time?: number | null;
    error_message?: string | null;
    completed_at?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<AppExecution> {
  const updateResult = await updateCompleteExecutionData(
    executionId,
    completeData
  );

  if (!updateResult.success) {
    throw updateResult.error;
  }

  return updateResult.data;
}

export async function saveCompleteTextGenerationData({
  executionId,
  finalResult,
  taskId,
  messageId,
  generatedText,
  instanceId,
  updateCurrentExecution,
  addExecutionToHistory,
}: SaveCompleteTextGenerationDataParams): Promise<Result<AppExecution>> {
  console.log(
    '[Text Generation] Start saving complete data, executionId:',
    executionId
  );

  try {
    const persistedContent =
      preparePersistedTextGenerationContent(generatedText);
    const finalRawError = finalResult.error || null;
    const normalizedFinalError = finalRawError
      ? toUserFacingAgentError({
          source: 'dify-completion',
          message: finalRawError,
          locale: getTextGenerationLocale(),
        })
      : null;
    const finalStatus = determineTextGenerationFinalStatus(
      finalResult,
      persistedContent.storedText,
      messageId
    );
    const completedAt = new Date().toISOString();

    const resolvedErrorMessage =
      finalStatus === 'failed'
        ? normalizedFinalError?.userMessage ||
          finalRawError ||
          'Text generation failed'
        : null;
    const persistedOutputs =
      persistedContent.storedTextLength > 0
        ? { generated_text: persistedContent.storedText }
        : null;

    try {
      const updatedExecution = await persistTextGenerationUpdate(executionId, {
        status: finalStatus,
        external_execution_id: messageId,
        task_id: taskId,
        outputs: persistedOutputs,
        total_steps: 1,
        total_tokens: finalResult.usage?.total_tokens || 0,
        elapsed_time: finalResult.elapsed_time || null,
        error_message: resolvedErrorMessage,
        completed_at: completedAt,
        metadata: buildCompleteTextGenerationMetadata(
          finalResult,
          messageId,
          persistedContent,
          instanceId,
          finalStatus,
          completedAt,
          normalizedFinalError,
          finalRawError
        ),
      });

      console.log(
        '[Text Generation] ✅ Database update successful, final status:',
        finalStatus
      );

      conversationEvents.emit();
      updateCurrentExecution(updatedExecution);
      addExecutionToHistory(updatedExecution);

      return {
        success: true,
        data: updatedExecution,
      };
    } catch (detailedError) {
      console.warn(
        '[Text Generation] Failed to save detailed text generation data, retrying with compact metadata:',
        detailedError
      );
    }

    try {
      const updatedExecution = await persistTextGenerationUpdate(executionId, {
        status: finalStatus,
        external_execution_id: messageId,
        task_id: taskId,
        outputs: persistedOutputs,
        total_steps: 1,
        total_tokens: finalResult.usage?.total_tokens || 0,
        elapsed_time: finalResult.elapsed_time || null,
        error_message: resolvedErrorMessage,
        completed_at: completedAt,
        metadata: buildCompactCompleteTextGenerationMetadata(
          messageId,
          persistedContent,
          instanceId,
          finalStatus
        ),
      });

      console.log(
        '[Text Generation] ✅ Database update succeeded with compact metadata, final status:',
        finalStatus
      );

      conversationEvents.emit();
      updateCurrentExecution(updatedExecution);
      addExecutionToHistory(updatedExecution);

      return {
        success: true,
        data: updatedExecution,
      };
    } catch (compactError) {
      console.warn(
        '[Text Generation] Failed to save compact text generation data, falling back to failed status:',
        compactError
      );
    }

    const persistenceFailureMessage =
      finalStatus === 'failed'
        ? resolvedErrorMessage || TEXT_GENERATION_PERSISTENCE_FAILURE_MESSAGE
        : TEXT_GENERATION_PERSISTENCE_FAILURE_MESSAGE;
    const fallbackStatusResult = await updateExecutionStatus(
      executionId,
      'failed',
      persistenceFailureMessage,
      completedAt
    );

    if (!fallbackStatusResult.success || !fallbackStatusResult.data) {
      throw fallbackStatusResult.success
        ? new Error(TEXT_GENERATION_PERSISTENCE_FAILURE_MESSAGE)
        : fallbackStatusResult.error;
    }

    updateCurrentExecution({
      status: 'failed',
      error_message: persistenceFailureMessage,
      completed_at: completedAt,
    });
    conversationEvents.emit();

    return {
      success: false,
      error: new Error(persistenceFailureMessage),
    };
  } catch (error) {
    console.error(
      '[Text Generation] ❌ Error occurred while saving complete data:',
      error
    );
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export async function saveStoppedTextGenerationData({
  executionId,
  taskId,
  generatedText,
  instanceId,
  updateCurrentExecution,
  addExecutionToHistory,
}: SaveStoppedTextGenerationDataParams): Promise<Result<AppExecution>> {
  const persistedContent = preparePersistedTextGenerationContent(generatedText);
  const completedAt = new Date().toISOString();
  const persistedOutputs =
    persistedContent.storedTextLength > 0
      ? { generated_text: persistedContent.storedText }
      : null;

  try {
    const updatedExecution = await persistTextGenerationUpdate(executionId, {
      status: 'stopped',
      external_execution_id: null,
      task_id: taskId,
      outputs: persistedOutputs,
      total_steps: 1,
      total_tokens: 0,
      elapsed_time: null,
      error_message: 'Stopped by user',
      completed_at: completedAt,
      metadata: buildStoppedTextGenerationMetadata(
        persistedContent,
        taskId,
        instanceId
      ),
    });

    conversationEvents.emit();
    updateCurrentExecution(updatedExecution);
    addExecutionToHistory(updatedExecution);
    return {
      success: true,
      data: updatedExecution,
    };
  } catch (detailedError) {
    console.warn(
      '[Text Generation] Failed to save stopped text generation data, retrying with compact metadata:',
      detailedError
    );
  }

  try {
    const updatedExecution = await persistTextGenerationUpdate(executionId, {
      status: 'stopped',
      external_execution_id: null,
      task_id: taskId,
      outputs: persistedOutputs,
      total_steps: 1,
      total_tokens: 0,
      elapsed_time: null,
      error_message: 'Stopped by user',
      completed_at: completedAt,
      metadata: buildCompactStoppedTextGenerationMetadata(
        persistedContent,
        taskId,
        instanceId
      ),
    });

    conversationEvents.emit();
    updateCurrentExecution(updatedExecution);
    addExecutionToHistory(updatedExecution);
    return {
      success: true,
      data: updatedExecution,
    };
  } catch (compactError) {
    console.warn(
      '[Text Generation] Failed to save compact stopped text generation data, falling back to status-only update:',
      compactError
    );
  }

  const fallbackStatusResult = await updateExecutionStatus(
    executionId,
    'stopped',
    'Stopped by user',
    completedAt
  );

  if (!fallbackStatusResult.success || !fallbackStatusResult.data) {
    return fallbackStatusResult.success
      ? {
          success: false,
          error: new Error('Failed to persist stopped text generation status'),
        }
      : {
          success: false,
          error: fallbackStatusResult.error,
        };
  }

  updateCurrentExecution({
    status: 'stopped',
    error_message: 'Stopped by user',
    completed_at: completedAt,
  });
  conversationEvents.emit();

  return {
    success: false,
    error: new Error(
      'Stopped text generation output could not be fully persisted'
    ),
  };
}
