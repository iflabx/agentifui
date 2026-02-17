import { useProfile } from '@lib/hooks/use-profile';
import {
  createExecution,
  getExecutionsByServiceInstance,
  updateCompleteExecutionData,
  updateExecutionStatus,
} from '@lib/services/client/app-executions-api';
import type {
  DifyWorkflowFinishedData,
  DifyWorkflowRequestPayload,
  DifyWorkflowSseEvent,
  DifyWorkflowStreamResponse,
} from '@lib/services/dify/types';
import { useAutoAddFavoriteApp } from '@lib/stores/favorite-apps-store';
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import type { AppExecution, ExecutionStatus } from '@lib/types/database';

import { useCallback, useEffect, useRef } from 'react';

import { useDateFormatter } from './use-date-formatter';

type WorkflowNodeEvent = Extract<
  DifyWorkflowSseEvent,
  { data: { node_id: string } }
>;

type WorkflowNodeSnapshot = {
  node_id: string;
  node_type?: string;
  title?: string;
  status?: 'running' | 'succeeded' | 'failed' | 'stopped';
  inputs?: Record<string, unknown>;
  outputs?: unknown;
  process_data?: unknown;
  execution_metadata?: unknown;
  elapsed_time?: number;
  total_tokens?: number;
  total_price?: string;
  currency?: string;
  error?: string | null;
  created_at?: number;
  index?: number;
  predecessor_node_id?: string;
  event_type: WorkflowNodeEvent['event'];
};

function isWorkflowNodeEvent(
  event: DifyWorkflowSseEvent
): event is WorkflowNodeEvent {
  if (!('data' in event)) {
    return false;
  }
  const data = event.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    'node_id' in data &&
    typeof data.node_id === 'string'
  );
}

/**
 * Workflow execution hook - robust data saving version
 *
 * Core responsibilities:
 * - Implements the complete workflow execution process
 * - Ensures all data returned from Dify is fully saved to the database
 * - Provides error handling and recovery mechanisms
 * - Manages data consistency
 */
export function useWorkflowExecution(instanceId: string) {
  const { profile } = useProfile();
  const userId = profile?.id;
  const { formatDate } = useDateFormatter();

  // Add favorite app management hook
  const { addToFavorites } = useAutoAddFavoriteApp();

  // --- Safely get store state to avoid frequent re-renders ---
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

  // --- Use ref to get store actions to avoid dependency issues ---
  const getActions = useCallback(
    () => useWorkflowExecutionStore.getState(),
    []
  );

  // --- SSE connection reference ---
  const sseConnectionRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const createTitle = useCallback(
    () =>
      `Workflow Execution - ${formatDate(new Date(), { includeTime: true, style: 'medium' })}`,
    [formatDate]
  );

  /**
   * Robust data saving function
   * Ensures all fields returned from Dify are fully saved to the database
   */
  const saveCompleteExecutionData = useCallback(
    async (
      executionId: string,
      finalResult: DifyWorkflowFinishedData,
      taskId: string | null,
      workflowRunId: string | null,
      nodeExecutionData: WorkflowNodeSnapshot[] = []
    ) => {
      console.log(
        '[Workflow Execution] Start robust data saving, executionId:',
        executionId
      );
      console.log(
        '[Workflow Execution] finalResult:',
        JSON.stringify(finalResult, null, 2)
      );
      console.log('[Workflow Execution] taskId:', taskId);
      console.log('[Workflow Execution] workflowRunId:', workflowRunId);
      console.log('[Workflow Execution] nodeExecutionData:', nodeExecutionData);

      try {
        // Determine final status
        const finalStatus: ExecutionStatus =
          finalResult.status === 'succeeded' ? 'completed' : 'failed';
        const completedAt = new Date().toISOString();

        // --- Build complete metadata object, including all possible Dify data ---
        const completeMetadata = {
          // Dify original response data
          dify_response: {
            workflow_id: finalResult.workflow_id || null,
            created_at: finalResult.created_at || null,
            finished_at: finalResult.finished_at || null,
          },

          // Node execution details
          node_executions: nodeExecutionData.map(node => ({
            node_id: node.node_id,
            node_type: node.node_type || null,
            title: node.title || null,
            status: node.status,
            inputs: node.inputs || null,
            outputs: node.outputs || null,
            process_data: node.process_data || null,
            execution_metadata: node.execution_metadata || null,
            elapsed_time: node.elapsed_time || null,
            total_tokens: node.total_tokens || null,
            total_price: node.total_price || null,
            currency: node.currency || null,
            error: node.error || null,
            created_at: node.created_at || null,
            index: node.index || null,
            predecessor_node_id: node.predecessor_node_id || null,
          })),

          // Execution context information
          execution_context: {
            user_agent:
              typeof window !== 'undefined' ? window.navigator.userAgent : null,
            timestamp: new Date().toISOString(),
            instance_id: instanceId,
            execution_mode: 'streaming',
          },

          // Statistics summary
          statistics: {
            total_node_count: nodeExecutionData.length,
            successful_nodes: nodeExecutionData.filter(
              n => n.status === 'succeeded'
            ).length,
            failed_nodes: nodeExecutionData.filter(n => n.status === 'failed')
              .length,
            total_node_tokens: nodeExecutionData.reduce(
              (sum, n) => sum + (n.total_tokens || 0),
              0
            ),
            total_node_elapsed_time: nodeExecutionData.reduce(
              (sum, n) => sum + (n.elapsed_time || 0),
              0
            ),
          },
        };

        console.log(
          '[Workflow Execution] Ready to save complete data to database'
        );

        // --- Perform database update ---
        const updateResult = await updateCompleteExecutionData(executionId, {
          status: finalStatus,
          external_execution_id: workflowRunId,
          task_id: taskId,
          outputs: finalResult.outputs,
          total_steps: finalResult.total_steps,
          total_tokens: finalResult.total_tokens ?? undefined,
          elapsed_time: finalResult.elapsed_time ?? undefined,
          error_message: finalResult.error,
          completed_at: completedAt,
          metadata: completeMetadata,
        });

        if (updateResult.success) {
          console.log('[Workflow Execution] ✅ Database update successful');

          // Use the complete data returned from the database to update the store
          const completeExecution = updateResult.data;

          // Update store state
          getActions().updateCurrentExecution(completeExecution);
          getActions().addExecutionToHistory(completeExecution);

          return { success: true, data: completeExecution };
        } else {
          console.error(
            '[Workflow Execution] ❌ Database update failed:',
            updateResult.error
          );
          return { success: false, error: updateResult.error };
        }
      } catch (error) {
        console.error(
          '[Workflow Execution] ❌ Error occurred while saving complete data:',
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
   * Core execution process: complete workflow execution
   */
  const executeWorkflow = useCallback(
    async (formData: Record<string, unknown>) => {
      if (!userId) {
        getActions().setError('User not logged in, please log in first');
        return;
      }

      console.log(
        '[Workflow Execution] Start execution process, instanceId:',
        instanceId
      );

      // Used to collect node execution data
      const nodeExecutionData: WorkflowNodeSnapshot[] = [];

      // Declare streamResponse variable for use in catch block
      let streamResponse: DifyWorkflowStreamResponse | null = null;

      try {
        // --- Step 1: Set initial execution state ---
        getActions().startExecution(formData);
        getActions().clearError();

        // --- Step 1.5: Get correct app UUID ---
        const { useAppListStore } = await import('@lib/stores/app-list-store');
        const appListState = useAppListStore.getState();

        // If app list is empty, fetch app list first
        if (appListState.apps.length === 0) {
          console.log(
            '[Workflow Execution] App list is empty, fetching app list'
          );
          await appListState.fetchApps();
        }

        // Find the corresponding app record
        const currentApps = useAppListStore.getState().apps;
        const targetApp = currentApps.find(
          app => app.instance_id === instanceId
        );

        if (!targetApp) {
          throw new Error(`App record not found: ${instanceId}`);
        }

        console.log(
          '[Workflow Execution] Found app record, UUID:',
          targetApp.id,
          'instance_id:',
          targetApp.instance_id
        );

        // --- Step 2: Create a pending status database record ---
        const executionData: Omit<
          AppExecution,
          'id' | 'created_at' | 'updated_at'
        > = {
          user_id: userId,
          service_instance_id: targetApp.id, // Use UUID as primary key
          execution_type: 'workflow',
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
        console.log(
          '[Workflow Execution] Database record created successfully, ID:',
          dbExecution.id
        );
        getActions().setCurrentExecution(dbExecution);

        // --- Step 3: Update status to running ---
        const updateRunningResult = await updateExecutionStatus(
          dbExecution.id,
          'running'
        );

        if (updateRunningResult.success) {
          getActions().updateCurrentExecution({ status: 'running' });
        }

        // --- Step 4: Prepare Dify API call payload ---
        const difyPayload: DifyWorkflowRequestPayload = {
          inputs: formData,
          response_mode: 'streaming' as const,
          user: userId,
        };

        console.log(
          '[Workflow Execution] Preparing to call Dify API, payload:',
          JSON.stringify(difyPayload, null, 2)
        );

        // --- Step 5: Call Dify streaming API ---
        const { streamDifyWorkflow } = await import(
          '@lib/services/dify/workflow-service'
        );

        // Create abort controller
        abortControllerRef.current = new AbortController();

        streamResponse = await streamDifyWorkflow(difyPayload, instanceId);

        console.log(
          '[Workflow Execution] Dify streaming response started successfully'
        );

        // --- Step 6: Handle SSE event stream and collect all data ---
        console.log('[Workflow Execution] Start handling SSE event stream');

        // Handle progress events and collect all data - using enhanced event handler
        for await (const event of streamResponse.progressStream) {
          if (abortControllerRef.current?.signal.aborted) {
            console.log('[Workflow Execution] Execution aborted');
            break;
          }

          // Use new unified event handler, supports iteration and parallel branches
          getActions().handleNodeEvent(event);

          if (!isWorkflowNodeEvent(event)) {
            continue;
          }
          const nodeData: WorkflowNodeSnapshot = {
            ...(event.data as Partial<WorkflowNodeSnapshot>),
            node_id: event.data.node_id,
            event_type: event.event,
          };

          // Collect node data for database saving
          const existingNodeIndex = nodeExecutionData.findIndex(
            n => n.node_id === nodeData.node_id
          );
          if (existingNodeIndex >= 0) {
            // Update existing node data
            nodeExecutionData[existingNodeIndex] = {
              ...nodeExecutionData[existingNodeIndex],
              ...nodeData,
            };
          } else {
            // Add new node data
            nodeExecutionData.push(nodeData);
          }
        }

        // --- Step 7: Wait for final completion result ---
        const finalResult = await streamResponse.completionPromise;

        console.log(
          '[Workflow Execution] Workflow execution completed, final result:',
          JSON.stringify(finalResult, null, 2)
        );

        // --- Step 8: Get final Dify identifiers ---
        const taskId = streamResponse.getTaskId();
        const workflowRunId = streamResponse.getWorkflowRunId();

        console.log(
          '[Workflow Execution] Final identifiers - taskId:',
          taskId,
          'workflowRunId:',
          workflowRunId
        );

        // --- Step 9: Robust complete data saving ---
        const saveResult = await saveCompleteExecutionData(
          dbExecution.id,
          finalResult,
          taskId,
          workflowRunId,
          nodeExecutionData
        );

        if (!saveResult.success) {
          throw new Error(
            `Failed to save complete data: ${saveResult.error?.message || 'Unknown error'}`
          );
        }

        // Add app to favorites after successful workflow execution
        // This is the best timing: ensure the workflow is truly successful and only add once on first execution
        console.log(`[Workflow Execution] Add app to favorites: ${instanceId}`);
        addToFavorites(instanceId);

        // Finish execution
        getActions().stopExecution();
        getActions().unlockForm();

        console.log(
          '[Workflow Execution] ✅ Execution process completed, all data fully saved'
        );
      } catch (error) {
        console.error('[Workflow Execution] ❌ Execution failed:', error);

        // Error handling: try to save error status and collected data
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        getActions().setError(errorMessage, true);

        // If there is a current execution record, try to save error status and collected data
        const current = useWorkflowExecutionStore.getState().currentExecution;
        if (current?.id) {
          try {
            console.log(
              '[Workflow Execution] Try to save error status and collected data'
            );

            // Get possible identifiers (if streamResponse exists)
            let taskId: string | null = null;
            let workflowRunId: string | null = null;

            try {
              // Try to get identifiers from streamResponse if it exists
              if (streamResponse) {
                taskId = streamResponse.getTaskId() || null;
                workflowRunId = streamResponse.getWorkflowRunId() || null;
              }
            } catch (streamError) {
              console.warn(
                '[Workflow Execution] Unable to get streamResponse identifiers:',
                streamError
              );
            }

            // Build complete error status data
            const errorMetadata = {
              error_details: {
                message: errorMessage,
                timestamp: new Date().toISOString(),
                collected_node_data: nodeExecutionData,
              },
              execution_context: {
                user_agent:
                  typeof window !== 'undefined'
                    ? window.navigator.userAgent
                    : null,
                instance_id: instanceId,
                execution_mode: 'streaming',
              },
            };

            await updateCompleteExecutionData(current.id, {
              status: 'failed',
              error_message: errorMessage,
              completed_at: new Date().toISOString(),
              external_execution_id: workflowRunId,
              task_id: taskId,
              metadata: errorMetadata,
            });

            getActions().updateCurrentExecution({
              status: 'failed',
              error_message: errorMessage,
              completed_at: new Date().toISOString(),
              external_execution_id: workflowRunId,
              task_id: taskId,
              metadata: errorMetadata,
            });

            console.log('[Workflow Execution] ✅ Error status and data saved');
          } catch (updateError) {
            console.error(
              '[Workflow Execution] ❌ Error while updating failed status:',
              updateError
            );
          }
        }
      } finally {
        // Clean up resources
        if (sseConnectionRef.current) {
          sseConnectionRef.current.close();
          sseConnectionRef.current = null;
        }
        if (abortControllerRef.current) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      instanceId,
      userId,
      getActions,
      saveCompleteExecutionData,
      addToFavorites,
      createTitle,
    ]
  );

  /**
   * Stop workflow execution
   */
  const stopWorkflowExecution = useCallback(async () => {
    console.log('[Workflow Execution] Stop workflow execution');

    try {
      // Abort network request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Close SSE connection
      if (sseConnectionRef.current) {
        sseConnectionRef.current.close();
        sseConnectionRef.current = null;
      }

      // Get current state
      const state = useWorkflowExecutionStore.getState();

      // If there is a Dify task ID, try to stop Dify workflow
      if (state.difyTaskId && userId) {
        try {
          const { stopDifyWorkflow } = await import(
            '@lib/services/dify/workflow-service'
          );
          await stopDifyWorkflow(instanceId, state.difyTaskId, userId);
          console.log('[Workflow Execution] Dify workflow stopped');
        } catch (stopError) {
          console.warn(
            '[Workflow Execution] Failed to stop Dify workflow:',
            stopError
          );
        }
      }

      // Update store state
      getActions().stopExecution();

      // Update database record status
      if (state.currentExecution?.id) {
        try {
          await updateExecutionStatus(
            state.currentExecution.id,
            'stopped',
            'Stopped by user',
            new Date().toISOString()
          );

          getActions().updateCurrentExecution({
            status: 'stopped',
            error_message: 'Stopped by user',
            completed_at: new Date().toISOString(),
          });
        } catch (updateError) {
          console.error(
            '[Workflow Execution] Error while updating stopped status:',
            updateError
          );
        }
      }
    } catch (error) {
      console.error(
        '[Workflow Execution] Error while stopping execution:',
        error
      );
      getActions().setError('Failed to stop execution');
    }
  }, [instanceId, userId, getActions]);

  /**
   * Load workflow execution history
   */
  const loadWorkflowHistory = useCallback(async () => {
    if (!userId) return;

    console.log('[Workflow Execution] Load history, instanceId:', instanceId);

    try {
      // --- Get correct app UUID ---
      const { useAppListStore } = await import('@lib/stores/app-list-store');
      const appListState = useAppListStore.getState();

      // If app list is empty, fetch app list first
      if (appListState.apps.length === 0) {
        console.log(
          '[Workflow Execution] History load: app list is empty, fetching app list'
        );
        await appListState.fetchApps();
      }

      // Find the corresponding app record
      const currentApps = useAppListStore.getState().apps;
      const targetApp = currentApps.find(app => app.instance_id === instanceId);

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

      const result = await getExecutionsByServiceInstance(targetApp.id, 20); // Use UUID as primary key, add user ID filter

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
    } catch (error) {
      console.error('[Workflow Execution] Error while loading history:', error);
    }
  }, [instanceId, userId, getActions]);

  /**
   * Retry execution
   */
  const retryExecution = useCallback(async () => {
    const state = useWorkflowExecutionStore.getState();
    if (state.formData && Object.keys(state.formData).length > 0) {
      console.log('[Workflow Execution] Retry execution');
      getActions().clearError();
      await executeWorkflow(state.formData);
    } else {
      console.warn('[Workflow Execution] Cannot retry: no form data');
      getActions().setError('Cannot retry: no form data');
    }
  }, [executeWorkflow, getActions]);

  /**
   * Reset execution state
   */
  const resetExecution = useCallback(() => {
    console.log('[Workflow Execution] Reset execution state');

    // Clean up connections
    if (sseConnectionRef.current) {
      sseConnectionRef.current.close();
      sseConnectionRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Reset store state
    getActions().reset();
  }, [getActions]);

  /**
   * Fully reset (including form data)
   */
  const resetAll = useCallback(() => {
    console.log('[Workflow Execution] Fully reset all state');

    // Clean up connections
    if (sseConnectionRef.current) {
      sseConnectionRef.current.close();
      sseConnectionRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Completely clear store state
    getActions().clearAll();
  }, [getActions]);

  /**
   * Clear only execution state (keep form data and history)
   */
  const clearExecutionState = useCallback(() => {
    console.log('[Workflow Execution] Clear execution state');

    // Clean up connections
    if (sseConnectionRef.current) {
      sseConnectionRef.current.close();
      sseConnectionRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Only clear execution-related state
    getActions().clearExecutionState();
  }, [getActions]);

  // --- Clean up resources on component unmount ---
  useEffect(() => {
    return () => {
      if (sseConnectionRef.current) {
        sseConnectionRef.current.close();
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // --- Clear execution state on route change ---
  useEffect(() => {
    // When instanceId changes, clear previous execution state
    console.log(
      '[Workflow Execution] instanceId changed, clear execution state:',
      instanceId
    );
    clearExecutionState();
  }, [instanceId, clearExecutionState]);

  // --- Load history on initialization ---
  useEffect(() => {
    if (userId && instanceId) {
      loadWorkflowHistory();
    }
  }, [userId, instanceId, loadWorkflowHistory]);

  return {
    // --- State ---
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

    // --- Methods ---
    executeWorkflow,
    stopWorkflowExecution,
    retryExecution,
    resetExecution,
    resetAll,
    clearExecutionState,
    loadWorkflowHistory,
  };
}
