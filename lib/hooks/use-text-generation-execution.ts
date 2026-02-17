import { useProfile } from '@lib/hooks/use-profile';
import {
  createExecution,
  getExecutionsByServiceInstance,
  updateCompleteExecutionData,
  updateExecutionStatus,
} from '@lib/services/client/app-executions-api';
import type { DifyCompletionRequestPayload } from '@lib/services/dify/types';
import { useAutoAddFavoriteApp } from '@lib/stores/favorite-apps-store';
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import type { AppExecution, ExecutionStatus } from '@lib/types/database';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useDateFormatter } from './use-date-formatter';

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

  // --- Favorite app management hook ---
  const { addToFavorites } = useAutoAddFavoriteApp();

  // --- Reuse workflow state management ---
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

  // --- Text generation specific state ---
  const [generatedText, setGeneratedText] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);

  // --- Get store actions via ref ---
  const getActions = useCallback(
    () => useWorkflowExecutionStore.getState(),
    []
  );

  // --- Streaming response ref ---
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Save complete text generation data
   */
  const saveCompleteGenerationData = useCallback(
    async (
      executionId: string,
      finalResult: any,
      taskId: string | null,
      messageId: string | null,
      generatedText: string
    ) => {
      console.log(
        '[Text Generation] Start saving complete data, executionId:',
        executionId
      );

      try {
        // --- More strict status determination ---
        let finalStatus: ExecutionStatus;

        if (generatedText && generatedText.length > 0) {
          // If there is generated content, consider as completed
          finalStatus = 'completed';
          console.log(
            '[Text Generation] Detected generated content, status set to completed'
          );
        } else if (finalResult?.error) {
          // If there is error info, consider as failed
          finalStatus = 'failed';
          console.log(
            '[Text Generation] Detected error info, status set to failed'
          );
        } else {
          // Otherwise, determine by messageId
          finalStatus = messageId ? 'completed' : 'failed';
          console.log(
            '[Text Generation] Status determined by messageId:',
            finalStatus
          );
        }

        const completedAt = new Date().toISOString();

        // --- Build metadata for text generation ---
        const completeMetadata = {
          // Dify original response data
          dify_response: {
            message_id: messageId,
            created_at: finalResult?.created_at || null,
            conversation_id: finalResult?.conversation_id || null,
          },

          // Generation content
          generation_data: {
            generated_text: generatedText,
            text_length: generatedText.length,
            word_count: generatedText
              .split(/\s+/)
              .filter(word => word.length > 0).length,
            has_content: generatedText.length > 0,
          },

          // Execution environment info
          execution_context: {
            user_agent:
              typeof window !== 'undefined' ? window.navigator.userAgent : null,
            timestamp: new Date().toISOString(),
            instance_id: instanceId,
            execution_mode: 'streaming',
            api_type: 'completion',
            final_status: finalStatus,
          },

          // Error info (if any)
          ...(finalResult?.error && {
            error_details: {
              message: finalResult.error,
              timestamp: completedAt,
            },
          }),
        };

        // --- Update database ---
        const updateResult = await updateCompleteExecutionData(executionId, {
          status: finalStatus,
          external_execution_id: messageId,
          task_id: taskId,
          outputs: { generated_text: generatedText },
          total_steps: 1, // Text generation is usually single step
          total_tokens: finalResult?.usage?.total_tokens || 0,
          elapsed_time: finalResult?.elapsed_time || null,
          error_message:
            finalStatus === 'failed'
              ? finalResult?.error || 'Text generation failed'
              : null,
          completed_at: completedAt,
          metadata: completeMetadata,
        });

        if (updateResult.success) {
          console.log(
            '[Text Generation] ✅ Database update successful, final status:',
            finalStatus
          );

          // Update store state
          const completeExecution = updateResult.data;
          getActions().updateCurrentExecution(completeExecution);
          getActions().addExecutionToHistory(completeExecution);

          return { success: true, data: completeExecution };
        } else {
          console.error(
            '[Text Generation] ❌ Database update failed:',
            updateResult.error
          );
          return { success: false, error: updateResult.error };
        }
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
    },
    [instanceId, getActions]
  );

  /**
   * Core execution process: text generation
   */
  const executeTextGeneration = useCallback(
    async (formData: Record<string, any>) => {
      if (!userId) {
        getActions().setError('User not logged in, please log in first');
        return;
      }

      console.log(
        '[Text Generation] Start execution process, instanceId:',
        instanceId
      );

      let streamResponse: any = null;

      try {
        // --- Step 1: Set initial execution state ---
        getActions().startExecution(formData);
        getActions().clearError();
        setGeneratedText('');
        setIsStreaming(true);

        // --- Step 2: Get app info ---
        const { useAppListStore } = await import('@lib/stores/app-list-store');
        const appListState = useAppListStore.getState();

        if (appListState.apps.length === 0) {
          await appListState.fetchApps();
        }

        const currentApps = useAppListStore.getState().apps;
        const targetApp = currentApps.find(
          app => app.instance_id === instanceId
        );

        if (!targetApp) {
          throw new Error(`App record not found: ${instanceId}`);
        }

        // --- Step 3: Create database record ---
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
          inputs: formData,
          outputs: null,
          status: 'pending',
          error_message: null,
          total_steps: 0,
          total_tokens: 0,
          elapsed_time: null,
          completed_at: null,
          metadata: {
            execution_started_at: new Date().toISOString(),
            initial_form_data: formData,
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

        // --- Step 4: Update status to running ---
        await updateExecutionStatus(dbExecution.id, 'running');
        getActions().updateCurrentExecution({ status: 'running' });

        // --- Step 5: Prepare Dify API payload ---
        const difyPayload: DifyCompletionRequestPayload = {
          inputs: formData,
          response_mode: 'streaming' as const,
          user: userId,
        };

        // --- Step 6: Call Dify streaming API ---
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
        let completionResult: any = null;

        // --- Step 7: Handle streaming response ---
        for await (const textChunk of streamResponse.answerStream) {
          if (abortControllerRef.current?.signal.aborted) {
            console.log(
              '[Text Generation] Abort signal detected, stopping processing'
            );
            break;
          }

          accumulatedText += textChunk;
          setGeneratedText(accumulatedText);

          // Update progress (estimate based on text length)
          const estimatedProgress = Math.min(
            (accumulatedText.length / 1000) * 100,
            90
          );
          getActions().setExecutionProgress(estimatedProgress);

          // --- Set taskId for stop usage ---
          const currentTaskId = streamResponse.getTaskId();
          if (currentTaskId && !getActions().difyTaskId) {
            getActions().setDifyTaskId(currentTaskId);
            console.log('[Text Generation] Set difyTaskId:', currentTaskId);
          }
        }

        // --- Step 8: Wait for completion and get final result ---
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
              usage: completionResult?.usage,
            }
          );
        } catch (completionError) {
          console.error(
            '[Text Generation] Error while waiting for completion:',
            completionError
          );
          // Even if completionPromise fails, if there is generated text, still try to save
          if (accumulatedText.length > 0) {
            console.log(
              '[Text Generation] Error on completion, but generated content exists, continue saving'
            );
            completionResult = { usage: null, metadata: {} };
          } else {
            throw completionError;
          }
        }

        // --- Step 9: Save complete data ---
        const saveResult = await saveCompleteGenerationData(
          dbExecution.id,
          completionResult,
          taskId,
          messageId,
          accumulatedText
        );

        if (!saveResult.success) {
          console.error(
            '[Text Generation] Failed to save complete data:',
            saveResult.error
          );
          throw new Error(`Failed to save data: ${saveResult.error}`);
        }

        // --- Step 10: Update final status ---
        console.log('[Text Generation] Start updating final status');

        // Update progress to 100%
        getActions().setExecutionProgress(100);

        // Stop streaming state
        setIsStreaming(false);

        // Ensure execution state is properly stopped
        getActions().stopExecution();

        // Update current execution record to latest complete data
        if (saveResult.data) {
          getActions().updateCurrentExecution(saveResult.data);
        }

        // --- Auto add to favorite apps ---
        addToFavorites(targetApp.instance_id);

        console.log(
          '[Text Generation] ✅ Execution completed, status transitioned correctly'
        );
      } catch (error) {
        console.error('[Text Generation] ❌ Execution failed:', error);

        // Clean up streaming state
        setIsStreaming(false);

        // Set error state
        getActions().setError(
          error instanceof Error ? error.message : 'Text generation failed',
          true // allow retry
        );

        // Update database status to failed
        if (currentExecution?.id) {
          try {
            await updateExecutionStatus(
              currentExecution.id,
              'failed',
              error instanceof Error ? error.message : 'Text generation failed'
            );

            // Update execution status in store
            getActions().updateCurrentExecution({
              status: 'failed',
              error_message:
                error instanceof Error
                  ? error.message
                  : 'Text generation failed',
            });
          } catch (updateError) {
            console.error(
              '[Text Generation] Error updating failed status:',
              updateError
            );
          }
        }
      } finally {
        // Clean up resources
        abortControllerRef.current = null;
      }
    },
    [
      userId,
      instanceId,
      getActions,
      saveCompleteGenerationData,
      addToFavorites,
      currentExecution,
      formatDate,
    ]
  );

  /**
   * Stop text generation
   */
  const stopTextGeneration = useCallback(async () => {
    console.log('[Text Generation] Stop execution');

    try {
      // Get current state
      const state = useWorkflowExecutionStore.getState();
      const currentText = generatedText; // Get current generated text

      // 1. Abort streaming response
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        console.log('[Text Generation] Streaming response aborted');
      }

      // 2. If taskId exists, call Dify stop API
      if (state.difyTaskId && userId) {
        try {
          const { useAppListStore } = await import(
            '@lib/stores/app-list-store'
          );
          const apps = useAppListStore.getState().apps;
          const targetApp = apps.find(app => app.instance_id === instanceId);

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
          // Even if stop API fails, continue to save data
        }
      }

      // 3. Update store state
      getActions().stopExecution();
      setIsStreaming(false);

      // 4. Save partial text to database (if any)
      if (currentExecution?.id && currentText && currentText.length > 0) {
        try {
          console.log(
            '[Text Generation] Saving partial text on stop, length:',
            currentText.length
          );

          // Build complete data for stop
          const stopMetadata = {
            // Dify original response data
            dify_response: {
              message_id: null, // May not have messageId on stop
              task_id: state.difyTaskId,
              stopped_by_user: true,
            },

            // Generation content
            generation_data: {
              generated_text: currentText,
              text_length: currentText.length,
              word_count: currentText
                .split(/\s+/)
                .filter(word => word.length > 0).length,
              has_content: true,
              is_partial: true, // Mark as partial content
            },

            // Execution environment info
            execution_context: {
              user_agent:
                typeof window !== 'undefined'
                  ? window.navigator.userAgent
                  : null,
              timestamp: new Date().toISOString(),
              instance_id: instanceId,
              execution_mode: 'streaming',
              api_type: 'completion',
              final_status: 'stopped',
              stop_reason: 'user_manual',
            },
          };

          // Update database record
          const updateResult = await updateCompleteExecutionData(
            currentExecution.id,
            {
              status: 'stopped',
              external_execution_id: null,
              task_id: state.difyTaskId,
              outputs: { generated_text: currentText },
              total_steps: 1,
              total_tokens: 0, // May not have token count on stop
              elapsed_time: null,
              error_message: 'Stopped by user',
              completed_at: new Date().toISOString(),
              metadata: stopMetadata,
            }
          );

          if (updateResult.success) {
            console.log('[Text Generation] ✅ Partial text saved to database');

            // Update execution record in store
            getActions().updateCurrentExecution(updateResult.data);
            getActions().addExecutionToHistory(updateResult.data);
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
      } else {
        // No generated content, just update status
        if (currentExecution?.id) {
          try {
            await updateExecutionStatus(
              currentExecution.id,
              'stopped',
              'Stopped by user',
              new Date().toISOString()
            );

            getActions().updateCurrentExecution({
              status: 'stopped',
              error_message: 'Stopped by user',
              completed_at: new Date().toISOString(),
            });

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
      }
    } catch (error) {
      console.error('[Text Generation] Failed to stop execution:', error);
      getActions().setError('Failed to stop execution');
    } finally {
      // Clean up resources
      abortControllerRef.current = null;
    }
  }, [instanceId, userId, currentExecution, getActions, generatedText]);

  /**
   * Retry text generation
   */
  const retryTextGeneration = useCallback(async () => {
    console.log('[Text Generation] Retry execution');

    if (formData) {
      getActions().clearError();
      await executeTextGeneration(formData);
    }
  }, [formData, executeTextGeneration, getActions]);

  /**
   * Reset state
   */
  const resetTextGeneration = useCallback(() => {
    console.log('[Text Generation] Reset state');
    getActions().reset();
    setGeneratedText('');
    setIsStreaming(false);
  }, [getActions]);

  /**
   * Load history - consistent with workflow logic
   */
  const loadTextGenerationHistory = useCallback(async () => {
    if (!userId) return;

    console.log('[Text Generation] Load history, instanceId:', instanceId);

    try {
      // --- Get correct app UUID ---
      const { useAppListStore } = await import('@lib/stores/app-list-store');
      const appListState = useAppListStore.getState();

      // If app list is empty, fetch app list first
      if (appListState.apps.length === 0) {
        console.log(
          '[Text Generation] History load: app list empty, fetching app list'
        );
        await appListState.fetchApps();
      }

      // Find corresponding app record
      const currentApps = useAppListStore.getState().apps;
      const targetApp = currentApps.find(app => app.instance_id === instanceId);

      if (!targetApp) {
        console.warn(
          '[Text Generation] App record not found, instanceId:',
          instanceId
        );
        getActions().setExecutionHistory([]);
        return;
      }

      console.log('[Text Generation] History query using UUID:', targetApp.id);

      const result = await getExecutionsByServiceInstance(
        targetApp.id,
        20
      ); // Use UUID as primary key, add userId filter

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
  }, [instanceId, userId, getActions]);

  // --- Load history on mount ---
  useEffect(() => {
    loadTextGenerationHistory();
  }, [loadTextGenerationHistory]);

  const createTitle = () =>
    `Text Generation - ${formatDate(new Date(), { includeTime: true, style: 'medium' })}`;

  return {
    // State
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

    // Actions
    executeTextGeneration,
    stopTextGeneration,
    retryTextGeneration,
    resetTextGeneration,
    loadTextGenerationHistory,
  };
}
