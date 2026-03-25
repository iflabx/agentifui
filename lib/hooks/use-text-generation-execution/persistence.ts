import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import { toUserFacingAgentError } from '@lib/services/agent-error/user-facing-error';
import { updateCompleteExecutionData } from '@lib/services/client/app-executions-api';
import type { AppExecution, ExecutionStatus } from '@lib/types/database';
import type { Result } from '@lib/types/result';

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

function getTextGenerationLocale(): string {
  return typeof navigator !== 'undefined' ? navigator.language : 'en-US';
}

function getTextGenerationUserAgent(): string | null {
  return typeof window !== 'undefined' ? window.navigator.userAgent : null;
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
  generatedText: string,
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
      generated_text: generatedText,
      text_length: generatedText.length,
      word_count: countGeneratedWords(generatedText),
      has_content: generatedText.length > 0,
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

function buildStoppedTextGenerationMetadata(
  generatedText: string,
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
      generated_text: generatedText,
      text_length: generatedText.length,
      word_count: countGeneratedWords(generatedText),
      has_content: true,
      is_partial: true,
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
      generatedText,
      messageId
    );
    const completedAt = new Date().toISOString();

    const updateResult = await updateCompleteExecutionData(executionId, {
      status: finalStatus,
      external_execution_id: messageId,
      task_id: taskId,
      outputs: { generated_text: generatedText },
      total_steps: 1,
      total_tokens: finalResult.usage?.total_tokens || 0,
      elapsed_time: finalResult.elapsed_time || null,
      error_message:
        finalStatus === 'failed'
          ? normalizedFinalError?.userMessage ||
            finalRawError ||
            'Text generation failed'
          : null,
      completed_at: completedAt,
      metadata: buildCompleteTextGenerationMetadata(
        finalResult,
        messageId,
        generatedText,
        instanceId,
        finalStatus,
        completedAt,
        normalizedFinalError,
        finalRawError
      ),
    });

    if (!updateResult.success) {
      console.error(
        '[Text Generation] ❌ Database update failed:',
        updateResult.error
      );
      return updateResult;
    }

    console.log(
      '[Text Generation] ✅ Database update successful, final status:',
      finalStatus
    );

    conversationEvents.emit();
    updateCurrentExecution(updateResult.data);
    addExecutionToHistory(updateResult.data);

    return updateResult;
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
  const completedAt = new Date().toISOString();
  const updateResult = await updateCompleteExecutionData(executionId, {
    status: 'stopped',
    external_execution_id: null,
    task_id: taskId,
    outputs: { generated_text: generatedText },
    total_steps: 1,
    total_tokens: 0,
    elapsed_time: null,
    error_message: 'Stopped by user',
    completed_at: completedAt,
    metadata: buildStoppedTextGenerationMetadata(
      generatedText,
      taskId,
      instanceId
    ),
  });

  if (!updateResult.success) {
    return updateResult;
  }

  conversationEvents.emit();
  updateCurrentExecution(updateResult.data);
  addExecutionToHistory(updateResult.data);
  return updateResult;
}
