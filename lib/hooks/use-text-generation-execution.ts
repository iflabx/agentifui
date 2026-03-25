import { formatUiErrorMessage, toUiError } from '@lib/errors/ui-error';
import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import { useProfile } from '@lib/hooks/use-profile';
import { toUserFacingAgentError } from '@lib/services/agent-error/user-facing-error';
import {
  createExecution,
  getExecutionsByServiceInstance,
  updateExecutionStatus,
} from '@lib/services/client/app-executions-api';
import type {
  DifyCompletionRequestPayload,
  DifyCompletionStreamResponse,
} from '@lib/services/dify/types';
import { useAutoAddFavoriteApp } from '@lib/stores/favorite-apps-store';
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import type { AppExecution } from '@lib/types/database';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useDateFormatter } from './use-date-formatter';
import { resolveTextGenerationTargetApp } from './use-text-generation-execution/app-instance';
import {
  saveCompleteTextGenerationData,
  saveStoppedTextGenerationData,
} from './use-text-generation-execution/persistence';
import { cleanupTextGenerationResources } from './use-text-generation-execution/resource-cleanup';
import {
  calculateTextGenerationProgress,
  createCompletionFallbackResult,
} from './use-text-generation-execution/stream-helpers';
import type { CompletionFinalResult } from './use-text-generation-execution/types';

/**
 * Text generation execution hook - reuses workflow architecture
 *
 * Core responsibilities:
 * - Implements the complete text generation execution process
 * - Reuses workflow state management and data persistence
 * - Adapts to the completion API characteristics
 * - Provides streaming text generation support
 */
export function useTextGenerationExecution(instanceId: string) {
  const { profile } = useProfile();
  const userId = profile?.id;
  const { formatDate } = useDateFormatter();
  const { addToFavorites } = useAutoAddFavoriteApp();

  const isExecuting = useWorkflowExecutionStore(state => state.isExecuting);
  const progress = useWorkflowExecutionStore(state => state.executionProgress);
  const error = useWorkflowExecutionStore(state => state.error);
  const canRetry = useWorkflowExecutionStore(state => state.canRetry);
  const currentExecution = useWorkflowExecutionStore(
    state => state.currentExecution
  );
  const executionHistory = useWorkflowExecutionStore(
    state => state.executionHistory
  );
  const formData = useWorkflowExecutionStore(state => state.formData);
  const formLocked = useWorkflowExecutionStore(state => state.formLocked);

  const [generatedText, setGeneratedText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const getActions = useCallback(
    () => useWorkflowExecutionStore.getState(),
    []
  );
  const abortControllerRef = useRef<AbortController | null>(null);

  const createTitle = useCallback(
    () =>
      `Text Generation - ${formatDate(new Date(), { includeTime: true, style: 'medium' })}`,
    [formatDate]
  );

  const executeTextGeneration = useCallback(
    async (nextFormData: Record<string, unknown>) => {
      if (!userId) {
        getActions().setError('User not logged in, please log in first');
        return;
      }

      console.log(
        '[Text Generation] Start execution process, instanceId:',
        instanceId
      );

      let streamResponse: DifyCompletionStreamResponse | null = null;

      try {
        getActions().startExecution(nextFormData);
        getActions().clearError();
        setGeneratedText('');
        setIsStreaming(true);

        const targetApp = await resolveTextGenerationTargetApp(
          instanceId,
          'execution'
        );
        if (!targetApp) {
          throw new Error(`App record not found: ${instanceId}`);
        }

        const executionData: Omit<
          AppExecution,
          'id' | 'created_at' | 'updated_at'
        > = {
          user_id: userId,
          service_instance_id: targetApp.id,
          execution_type: 'text-generation',
          external_execution_id: null,
          task_id: null,
          title: createTitle(),
          inputs: nextFormData,
          outputs: null,
          status: 'pending',
          error_message: null,
          total_steps: 0,
          total_tokens: 0,
          elapsed_time: null,
          completed_at: null,
          metadata: {
            execution_started_at: new Date().toISOString(),
            initial_form_data: nextFormData,
          },
        };

        const createResult = await createExecution(executionData);
        if (!createResult.success) {
          throw new Error(
            `Failed to create database record: ${createResult.error.message}`
          );
        }

        const dbExecution = createResult.data;
        getActions().setCurrentExecution(dbExecution);

        await updateExecutionStatus(dbExecution.id, 'running');
        getActions().updateCurrentExecution({ status: 'running' });

        const difyPayload: DifyCompletionRequestPayload = {
          inputs: nextFormData,
          response_mode: 'streaming',
          user: userId,
        };

        const { streamDifyCompletion } = await import(
          '@lib/services/dify/completion-service'
        );

        abortControllerRef.current = new AbortController();
        streamResponse = await streamDifyCompletion(
          targetApp.instance_id,
          difyPayload
        );

        let accumulatedText = '';
        let messageId: string | null = null;
        let taskId: string | null = null;
        let completionResult: CompletionFinalResult = {};

        for await (const textChunk of streamResponse.answerStream) {
          if (abortControllerRef.current?.signal.aborted) {
            console.log(
              '[Text Generation] Abort signal detected, stopping processing'
            );
            break;
          }

          accumulatedText += textChunk;
          setGeneratedText(accumulatedText);
          getActions().setExecutionProgress(
            calculateTextGenerationProgress(accumulatedText)
          );

          const currentTaskId = streamResponse.getTaskId();
          if (currentTaskId && !getActions().difyTaskId) {
            getActions().setDifyTaskId(currentTaskId);
            console.log('[Text Generation] Set difyTaskId:', currentTaskId);
          }
        }

        try {
          completionResult = await streamResponse.completionPromise;
          messageId = streamResponse.getMessageId();
          taskId = streamResponse.getTaskId();

          console.log(
            '[Text Generation] Streaming response finished, got final result:',
            {
              messageId,
              taskId,
              textLength: accumulatedText.length,
              usage: completionResult.usage,
            }
          );
        } catch (completionError) {
          console.error(
            '[Text Generation] Error while waiting for completion:',
            completionError
          );

          if (accumulatedText.length > 0) {
            console.log(
              '[Text Generation] Error on completion, but generated content exists, continue saving'
            );
            completionResult = createCompletionFallbackResult();
          } else {
            throw completionError;
          }
        }

        const saveResult = await saveCompleteTextGenerationData({
          executionId: dbExecution.id,
          finalResult: completionResult,
          taskId,
          messageId,
          generatedText: accumulatedText,
          instanceId,
          updateCurrentExecution: getActions().updateCurrentExecution,
          addExecutionToHistory: getActions().addExecutionToHistory,
        });

        if (!saveResult.success) {
          console.error(
            '[Text Generation] Failed to save complete data:',
            saveResult.error
          );
          throw new Error(
            `Failed to save data: ${saveResult.error.message || String(saveResult.error)}`
          );
        }

        console.log('[Text Generation] Start updating final status');
        getActions().setExecutionProgress(100);
        setIsStreaming(false);
        getActions().stopExecution();

        if (saveResult.data) {
          getActions().updateCurrentExecution(saveResult.data);
        }

        addToFavorites(targetApp.instance_id);

        console.log(
          '[Text Generation] ✅ Execution completed, status transitioned correctly'
        );
      } catch (error) {
        console.error('[Text Generation] ❌ Execution failed:', error);
        setIsStreaming(false);

        const rawErrorMessage =
          error instanceof Error ? error.message : 'Text generation failed';
        const normalizedError = toUserFacingAgentError({
          source: 'dify-completion',
          message: rawErrorMessage,
          locale:
            typeof navigator !== 'undefined' ? navigator.language : 'en-US',
        });
        const uiError = toUiError(
          error,
          normalizedError.userMessage,
          'dify-proxy'
        );
        const friendlyErrorMessage = formatUiErrorMessage(uiError);

        getActions().setError(friendlyErrorMessage, true);

        const currentState = useWorkflowExecutionStore.getState();
        if (currentState.currentExecution?.id) {
          try {
            await updateExecutionStatus(
              currentState.currentExecution.id,
              'failed',
              friendlyErrorMessage
            );

            getActions().updateCurrentExecution({
              status: 'failed',
              error_message: friendlyErrorMessage,
            });
          } catch (updateError) {
            console.error(
              '[Text Generation] Error updating failed status:',
              updateError
            );
          }
        }
      } finally {
        cleanupTextGenerationResources(abortControllerRef, false);
      }
    },
    [addToFavorites, createTitle, getActions, instanceId, userId]
  );

  const stopTextGeneration = useCallback(async () => {
    console.log('[Text Generation] Stop execution');

    try {
      const state = useWorkflowExecutionStore.getState();
      const currentText = generatedText;

      if (abortControllerRef.current) {
        cleanupTextGenerationResources(abortControllerRef, true);
        console.log('[Text Generation] Streaming response aborted');
      }

      if (state.difyTaskId && userId) {
        try {
          const targetApp = await resolveTextGenerationTargetApp(
            instanceId,
            'stop'
          );
          if (targetApp) {
            const { stopDifyCompletion } = await import(
              '@lib/services/dify/completion-service'
            );
            await stopDifyCompletion(
              targetApp.instance_id,
              state.difyTaskId,
              userId
            );
            console.log('[Text Generation] Dify task stopped');
          }
        } catch (stopError) {
          console.warn(
            '[Text Generation] Failed to stop Dify task:',
            stopError
          );
        }
      }

      getActions().stopExecution();
      setIsStreaming(false);

      if (state.currentExecution?.id && currentText.length > 0) {
        try {
          console.log(
            '[Text Generation] Saving partial text on stop, length:',
            currentText.length
          );

          const updateResult = await saveStoppedTextGenerationData({
            executionId: state.currentExecution.id,
            taskId: state.difyTaskId,
            generatedText: currentText,
            instanceId,
            updateCurrentExecution: getActions().updateCurrentExecution,
            addExecutionToHistory: getActions().addExecutionToHistory,
          });

          if (updateResult.success) {
            console.log('[Text Generation] ✅ Partial text saved to database');
          } else {
            console.error(
              '[Text Generation] ❌ Failed to save partial text:',
              updateResult.error
            );
          }
        } catch (saveError) {
          console.error(
            '[Text Generation] Error saving stop state:',
            saveError
          );
        }
      } else if (state.currentExecution?.id) {
        try {
          const completedAt = new Date().toISOString();
          await updateExecutionStatus(
            state.currentExecution.id,
            'stopped',
            'Stopped by user',
            completedAt
          );

          getActions().updateCurrentExecution({
            status: 'stopped',
            error_message: 'Stopped by user',
            completed_at: completedAt,
          });
          conversationEvents.emit();

          console.log(
            '[Text Generation] ✅ Execution status updated to stopped'
          );
        } catch (updateError) {
          console.error(
            '[Text Generation] Error updating stop status:',
            updateError
          );
        }
      }
    } catch (error) {
      console.error('[Text Generation] Failed to stop execution:', error);
      getActions().setError('Failed to stop execution');
    } finally {
      cleanupTextGenerationResources(abortControllerRef, false);
    }
  }, [generatedText, getActions, instanceId, userId]);

  const retryTextGeneration = useCallback(async () => {
    console.log('[Text Generation] Retry execution');

    if (formData) {
      getActions().clearError();
      await executeTextGeneration(formData);
    }
  }, [executeTextGeneration, formData, getActions]);

  const clearError = useCallback(() => {
    getActions().clearError();
  }, [getActions]);

  const resetTextGeneration = useCallback(() => {
    console.log('[Text Generation] Reset state');
    cleanupTextGenerationResources(abortControllerRef, true);
    getActions().reset();
    setGeneratedText('');
    setIsStreaming(false);
  }, [getActions]);

  const loadTextGenerationHistory = useCallback(async () => {
    if (!userId) return;

    console.log('[Text Generation] Load history, instanceId:', instanceId);

    try {
      const targetApp = await resolveTextGenerationTargetApp(
        instanceId,
        'history'
      );
      if (!targetApp) {
        console.warn(
          '[Text Generation] App record not found, instanceId:',
          instanceId
        );
        getActions().setExecutionHistory([]);
        return;
      }

      console.log('[Text Generation] History query using UUID:', targetApp.id);

      const result = await getExecutionsByServiceInstance(targetApp.id, 20);
      if (result.success) {
        console.log(
          '[Text Generation] History loaded successfully, count:',
          result.data.length
        );
        getActions().setExecutionHistory(result.data);
      } else {
        console.error(
          '[Text Generation] Failed to load history:',
          result.error
        );
      }
    } catch (error) {
      console.error('[Text Generation] Error loading history:', error);
    }
  }, [getActions, instanceId, userId]);

  useEffect(() => {
    loadTextGenerationHistory();
  }, [loadTextGenerationHistory]);

  useEffect(() => {
    return () => {
      cleanupTextGenerationResources(abortControllerRef, true);
    };
  }, []);

  return {
    isExecuting,
    isStreaming,
    progress,
    error,
    canRetry,
    currentExecution,
    executionHistory,
    formData,
    formLocked,
    generatedText,
    executeTextGeneration,
    stopTextGeneration,
    retryTextGeneration,
    clearError,
    resetTextGeneration,
    loadTextGenerationHistory,
  };
}
