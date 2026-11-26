import { formatUiErrorMessage, toUiError } from '@lib/errors/ui-error';
import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import { useProfile } from '@lib/hooks/use-profile';
import { toUserFacingAgentError } from '@lib/services/agent-error/user-facing-error';
import {
  type TaskExecutionReservation,
  createExecution,
  getExecutionsByServiceInstance,
  updateExecutionStatus,
} from '@lib/services/client/app-executions-api';
import { hasDefinitiveTaskOutcome } from '@lib/services/dify/submission';
import type {
  DifyWorkflowRequestPayload,
  DifyWorkflowStreamResponse,
} from '@lib/services/dify/types';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useAutoAddFavoriteApp } from '@lib/stores/favorite-apps-store';
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import type { AppExecution } from '@lib/types/database';

import { useCallback, useEffect, useRef } from 'react';

import { taskExecutionIsCurrent } from './task-execution-lifecycle';
import { useDateFormatter } from './use-date-formatter';
import { resolveWorkflowTargetApp } from './use-workflow-execution/app-instance';
import {
  buildNormalizedWorkflowInputs,
  isWorkflowNodeEvent,
  upsertWorkflowNodeSnapshot,
} from './use-workflow-execution/event-helpers';
import {
  saveCompleteWorkflowExecutionData,
  saveFailedWorkflowExecutionData,
} from './use-workflow-execution/persistence';
import { cleanupWorkflowExecutionResources } from './use-workflow-execution/resource-cleanup';
import type { WorkflowNodeSnapshot } from './use-workflow-execution/types';

/**
 * Workflow execution hook - robust data saving version
 *
 * Core responsibilities:
 * - Implements the complete workflow execution process
 * - Ensures all data returned from Dify is fully saved to the database
 * - Provides error handling and recovery mechanisms
 * - Manages data consistency
 */
export function useWorkflowExecution(instanceId: string, taskChat = false) {
  const { profile } = useProfile();
  const userId = profile?.id;
  const canStop = profile?.role === 'admin';
  const { formatDate } = useDateFormatter();
  const { addToFavorites } = useAutoAddFavoriteApp();

  const isExecuting = useWorkflowExecutionStore(state => state.isExecuting);
  const progress = useWorkflowExecutionStore(state => state.executionProgress);
  const error = useWorkflowExecutionStore(state => state.error);
  const canRetry = useWorkflowExecutionStore(state => state.canRetry);
  const nodes = useWorkflowExecutionStore(state => state.nodes);
  const currentNodeId = useWorkflowExecutionStore(state => state.currentNodeId);
  const currentExecution = useWorkflowExecutionStore(
    state => state.currentExecution
  );
  const executionHistory = useWorkflowExecutionStore(
    state => state.executionHistory
  );
  const formData = useWorkflowExecutionStore(state => state.formData);
  const formLocked = useWorkflowExecutionStore(state => state.formLocked);

  const getActions = useCallback(
    () => useWorkflowExecutionStore.getState(),
    []
  );

  const sseConnectionRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeMount = useRef(true);

  const createTitle = useCallback(
    () =>
      `Workflow Execution - ${formatDate(new Date(), { includeTime: true, style: 'medium' })}`,
    [formatDate]
  );

  const executeWorkflow = useCallback(
    async (
      nextFormData: Record<string, unknown>,
      reservation?: TaskExecutionReservation
    ) => {
      if (!userId) {
        getActions().setError('User not logged in, please log in first');
        return false;
      }

      console.log(
        '[Workflow Execution] Start execution process, instanceId:',
        instanceId
      );

      let nodeExecutionData: WorkflowNodeSnapshot[] = [];
      const normalizedInputs = buildNormalizedWorkflowInputs(nextFormData);
      let streamResponse: DifyWorkflowStreamResponse | null = null;
      let currentExecutionId: string | null = null;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const actorEpoch = useChatInputStore.getState().actorEpoch;
      const isCurrent = () =>
        activeMount.current &&
        (reservation
          ? taskExecutionIsCurrent(
              controller.signal,
              userId,
              actorEpoch,
              currentExecutionId
            )
          : !controller.signal.aborted);
      let generationDispatched = false;

      try {
        getActions().startExecution(nextFormData);
        getActions().clearError();

        const targetApp = await resolveWorkflowTargetApp(
          instanceId,
          'execution'
        );
        if (!isCurrent()) return false;
        if (!targetApp) {
          throw new Error(`App record not found: ${instanceId}`);
        }

        console.log(
          '[Workflow Execution] Found app record, UUID:',
          targetApp.id,
          'instance_id:',
          targetApp.instance_id
        );

        const executionData: Omit<
          AppExecution,
          'id' | 'created_at' | 'updated_at'
        > = {
          user_id: userId,
          service_instance_id: targetApp.id,
          execution_type: 'workflow',
          external_execution_id: null,
          task_id: null,
          title: createTitle(),
          inputs: normalizedInputs,
          outputs: null,
          status: 'pending',
          error_message: null,
          total_steps: 0,
          total_tokens: 0,
          elapsed_time: null,
          completed_at: null,
          metadata: {
            execution_started_at: new Date().toISOString(),
            initial_form_data: normalizedInputs,
          },
        };

        const createResult = reservation
          ? { success: true as const, data: reservation.execution }
          : await createExecution(executionData);
        if (!createResult.success) {
          throw new Error(
            `Failed to create database record: ${createResult.error.message}`
          );
        }

        const dbExecution = createResult.data;
        if (!isCurrent()) return false;
        if (
          dbExecution.service_instance_id !== targetApp.id ||
          dbExecution.execution_type !== 'workflow' ||
          (reservation &&
            dbExecution.submission_id !== reservation.submissionId)
        )
          throw new Error('Task reservation does not match this application');
        currentExecutionId = dbExecution.id;
        console.log(
          '[Workflow Execution] Database record created successfully, ID:',
          dbExecution.id
        );
        getActions().setCurrentExecution(dbExecution);

        const updateRunningResult = await updateExecutionStatus(
          dbExecution.id,
          'running'
        );
        if (!isCurrent()) return false;
        if (!updateRunningResult.success || !updateRunningResult.data)
          throw new Error('Task is deleted or no longer available');
        getActions().updateCurrentExecution({ status: 'running' });

        const difyPayload: DifyWorkflowRequestPayload = {
          inputs: normalizedInputs,
          response_mode: 'streaming',
          user: userId,
        };

        console.log(
          '[Workflow Execution] Preparing to call Dify API, payload:',
          JSON.stringify(difyPayload, null, 2)
        );

        const { streamDifyWorkflow } =
          await import('@lib/services/dify/workflow-service');

        if (!isCurrent()) return false;
        generationDispatched = true;
        streamResponse = await streamDifyWorkflow(
          difyPayload,
          instanceId,
          undefined,
          reservation ? { submissionId: reservation.submissionId } : undefined
        );

        console.log(
          '[Workflow Execution] Dify streaming response started successfully'
        );
        console.log('[Workflow Execution] Start handling SSE event stream');

        for await (const event of streamResponse.progressStream) {
          if (!isCurrent()) {
            console.log('[Workflow Execution] Execution aborted');
            break;
          }

          getActions().handleNodeEvent(event);

          if (!isWorkflowNodeEvent(event)) {
            continue;
          }

          const nodeData: WorkflowNodeSnapshot = {
            ...(event.data as Partial<WorkflowNodeSnapshot>),
            node_id: event.data.node_id,
            event_type: event.event,
          };

          nodeExecutionData = upsertWorkflowNodeSnapshot(
            nodeExecutionData,
            nodeData
          );
        }

        const finalResult = await streamResponse.completionPromise;
        if (!isCurrent()) return false;

        console.log(
          '[Workflow Execution] Workflow execution completed, final result:',
          JSON.stringify(finalResult, null, 2)
        );

        const taskId = streamResponse.getTaskId();
        const workflowRunId = streamResponse.getWorkflowRunId();

        console.log(
          '[Workflow Execution] Final identifiers - taskId:',
          taskId,
          'workflowRunId:',
          workflowRunId
        );

        const saveResult = await saveCompleteWorkflowExecutionData({
          executionId: dbExecution.id,
          finalResult,
          taskId,
          workflowRunId,
          nodeExecutionData,
          processNodes: reservation
            ? structuredClone(getActions().nodes)
            : undefined,
          instanceId,
          updateCurrentExecution: updates => {
            if (isCurrent()) getActions().updateCurrentExecution(updates);
          },
          addExecutionToHistory: execution => {
            if (isCurrent()) getActions().addExecutionToHistory(execution);
          },
        });
        if (!isCurrent()) return false;

        if (!saveResult.success) {
          throw new Error(
            `Failed to save complete data: ${saveResult.error.message || 'Unknown error'}`
          );
        }

        console.log(`[Workflow Execution] Add app to favorites: ${instanceId}`);
        addToFavorites(instanceId);

        getActions().stopExecution();
        getActions().unlockForm();

        console.log(
          '[Workflow Execution] ✅ Execution process completed, all data fully saved'
        );
        return true;
      } catch (caughtError) {
        if (!isCurrent()) return false;
        if (
          reservation &&
          generationDispatched &&
          !hasDefinitiveTaskOutcome(caughtError)
        ) {
          getActions().setError('TASK_OUTCOME_UNKNOWN');
          getActions().stopExecution();
          getActions().unlockForm();
          conversationEvents.emit();
          return false;
        }
        console.error('[Workflow Execution] ❌ Execution failed:', caughtError);

        const rawErrorMessage =
          caughtError instanceof Error ? caughtError.message : 'Unknown error';
        const normalizedError = toUserFacingAgentError({
          source: 'dify-workflow',
          message: rawErrorMessage,
          locale:
            typeof navigator !== 'undefined' ? navigator.language : 'en-US',
        });
        const uiError = toUiError(
          caughtError,
          normalizedError.userMessage,
          'dify-proxy'
        );
        const errorMessage = formatUiErrorMessage(uiError);
        getActions().setError(errorMessage, true);

        if (currentExecutionId) {
          try {
            await saveFailedWorkflowExecutionData({
              currentExecutionId,
              rawErrorMessage,
              errorMessage,
              errorCode: uiError.code || normalizedError.code,
              errorKind: normalizedError.kind,
              suggestion: normalizedError.suggestion,
              requestId: uiError.requestId || null,
              nodeExecutionData,
              streamResponse,
              instanceId,
              updateCurrentExecution: updates => {
                if (isCurrent()) getActions().updateCurrentExecution(updates);
              },
            });
          } catch (updateError) {
            if (!isCurrent()) return false;
            console.error(
              '[Workflow Execution] ❌ Error while updating failed status:',
              updateError
            );

            try {
              const completedAt = new Date().toISOString();
              await updateExecutionStatus(
                currentExecutionId,
                'failed',
                errorMessage,
                completedAt
              );
              if (!isCurrent()) return false;
              getActions().updateCurrentExecution({
                status: 'failed',
                error_message: errorMessage,
                completed_at: completedAt,
              });
              conversationEvents.emit();
            } catch (fallbackError) {
              console.error(
                '[Workflow Execution] ❌ Fallback failed status update failed:',
                fallbackError
              );
            }
          }
        }
        return false;
      } finally {
        if (abortControllerRef.current === controller)
          cleanupWorkflowExecutionResources(
            sseConnectionRef,
            abortControllerRef,
            false
          );
      }
    },
    [addToFavorites, createTitle, getActions, instanceId, userId]
  );

  const stopWorkflowExecution = useCallback(async () => {
    if (!canStop) return;
    console.log('[Workflow Execution] Stop workflow execution');
    const executionId = getActions().currentExecution?.id;
    const epoch = useChatInputStore.getState().actorEpoch;
    const canMutate = () =>
      activeMount.current &&
      (!taskChat ||
        (useChatInputStore.getState().actorId === userId &&
          useChatInputStore.getState().actorEpoch === epoch &&
          getActions().currentExecution?.id === executionId));

    try {
      cleanupWorkflowExecutionResources(
        sseConnectionRef,
        abortControllerRef,
        true
      );

      const state = useWorkflowExecutionStore.getState();

      if (state.difyTaskId && userId) {
        try {
          const { stopDifyWorkflow } =
            await import('@lib/services/dify/workflow-service');
          await stopDifyWorkflow(instanceId, state.difyTaskId, userId);
          console.log('[Workflow Execution] Dify workflow stopped');
        } catch (stopError) {
          console.warn(
            '[Workflow Execution] Failed to stop Dify workflow:',
            stopError
          );
        }
      }

      if (!canMutate()) return;
      getActions().stopExecution();

      if (state.currentExecution?.id) {
        try {
          const completedAt = new Date().toISOString();
          await updateExecutionStatus(
            state.currentExecution.id,
            'stopped',
            'Stopped by user',
            completedAt
          );
          if (!canMutate()) return;

          getActions().updateCurrentExecution({
            status: 'stopped',
            error_message: 'Stopped by user',
            completed_at: completedAt,
          });
          conversationEvents.emit();
        } catch (updateError) {
          console.error(
            '[Workflow Execution] Error while updating stopped status:',
            updateError
          );
        }
      }
    } catch (caughtError) {
      console.error(
        '[Workflow Execution] Error while stopping execution:',
        caughtError
      );
      getActions().setError('Failed to stop execution');
    }
  }, [canStop, getActions, instanceId, userId, taskChat]);

  const loadWorkflowHistory = useCallback(async () => {
    if (!userId) return;

    console.log('[Workflow Execution] Load history, instanceId:', instanceId);

    try {
      const targetApp = await resolveWorkflowTargetApp(instanceId, 'history');
      if (!targetApp) {
        console.warn(
          '[Workflow Execution] App record not found for history, instanceId:',
          instanceId
        );
        getActions().setExecutionHistory([]);
        return;
      }

      console.log(
        '[Workflow Execution] History query using UUID:',
        targetApp.id
      );

      const result = await getExecutionsByServiceInstance(targetApp.id, 20);
      if (result.success) {
        console.log(
          '[Workflow Execution] History loaded successfully, count:',
          result.data.length
        );
        getActions().setExecutionHistory(result.data);
      } else {
        console.error(
          '[Workflow Execution] Failed to load history:',
          result.error
        );
      }
    } catch (caughtError) {
      console.error(
        '[Workflow Execution] Error while loading history:',
        caughtError
      );
    }
  }, [getActions, instanceId, userId]);

  const retryExecution = useCallback(async () => {
    const state = useWorkflowExecutionStore.getState();
    if (state.formData && Object.keys(state.formData).length > 0) {
      console.log('[Workflow Execution] Retry execution');
      getActions().clearError();
      await executeWorkflow(state.formData);
      return;
    }

    console.warn('[Workflow Execution] Cannot retry: no form data');
    getActions().setError('Cannot retry: no form data');
  }, [executeWorkflow, getActions]);

  const resetExecution = useCallback(() => {
    console.log('[Workflow Execution] Reset execution state');
    cleanupWorkflowExecutionResources(
      sseConnectionRef,
      abortControllerRef,
      true
    );
    getActions().reset();
  }, [getActions]);

  const resetAll = useCallback(() => {
    console.log('[Workflow Execution] Fully reset all state');
    cleanupWorkflowExecutionResources(
      sseConnectionRef,
      abortControllerRef,
      true
    );
    getActions().clearAll();
  }, [getActions]);

  const clearExecutionState = useCallback(() => {
    console.log('[Workflow Execution] Clear execution state');
    cleanupWorkflowExecutionResources(
      sseConnectionRef,
      abortControllerRef,
      true
    );
    getActions().clearExecutionState();
  }, [getActions]);

  useEffect(() => {
    activeMount.current = true;
    return () => {
      activeMount.current = false;
      cleanupWorkflowExecutionResources(
        sseConnectionRef,
        abortControllerRef,
        true
      );
    };
  }, []);

  useEffect(() => {
    console.log(
      '[Workflow Execution] instanceId changed, clear execution state:',
      instanceId
    );
    clearExecutionState();
  }, [instanceId, clearExecutionState]);

  useEffect(() => {
    if (userId && instanceId && !taskChat) {
      loadWorkflowHistory();
    }
  }, [instanceId, loadWorkflowHistory, userId, taskChat]);

  return {
    isExecuting,
    progress,
    error,
    canRetry,
    nodes,
    currentNodeId,
    currentExecution,
    executionHistory,
    formData,
    formLocked,
    executeWorkflow,
    stopWorkflowExecution,
    canStop,
    retryExecution,
    resetExecution,
    resetAll,
    clearExecutionState,
    loadWorkflowHistory,
  };
}
