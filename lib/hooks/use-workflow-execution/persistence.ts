import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import { toUserFacingAgentError } from '@lib/services/agent-error/user-facing-error';
import { updateCompleteExecutionData } from '@lib/services/client/app-executions-api';
import type {
  DifyWorkflowFinishedData,
  DifyWorkflowStreamResponse,
} from '@lib/services/dify/types';
import type { AppExecution, ExecutionStatus } from '@lib/types/database';
import type { Result } from '@lib/types/result';

import type { WorkflowNodeSnapshot } from './types';

type WorkflowExecutionUpdater = (updates: Partial<AppExecution>) => void;

type SaveCompleteWorkflowExecutionDataParams = {
  executionId: string;
  finalResult: DifyWorkflowFinishedData;
  taskId: string | null;
  workflowRunId: string | null;
  nodeExecutionData?: WorkflowNodeSnapshot[];
  instanceId: string;
  updateCurrentExecution: WorkflowExecutionUpdater;
  addExecutionToHistory: (execution: AppExecution) => void;
};

type SaveFailedWorkflowExecutionDataParams = {
  currentExecutionId: string;
  rawErrorMessage: string;
  errorMessage: string;
  errorCode: string | null;
  errorKind: string;
  suggestion?: string | null;
  requestId: string | null;
  nodeExecutionData: WorkflowNodeSnapshot[];
  streamResponse: DifyWorkflowStreamResponse | null;
  instanceId: string;
  updateCurrentExecution: WorkflowExecutionUpdater;
};

function getWorkflowLocale(): string {
  return typeof navigator !== 'undefined' ? navigator.language : 'en-US';
}

function getWorkflowUserAgent(): string | null {
  return typeof window !== 'undefined' ? window.navigator.userAgent : null;
}

function buildCompleteWorkflowMetadata(
  finalResult: DifyWorkflowFinishedData,
  nodeExecutionData: WorkflowNodeSnapshot[],
  instanceId: string,
  normalizedFinalError: ReturnType<typeof toUserFacingAgentError> | null
): Record<string, unknown> {
  return {
    dify_response: {
      workflow_id: finalResult.workflow_id || null,
      created_at: finalResult.created_at || null,
      finished_at: finalResult.finished_at || null,
    },
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
    execution_context: {
      user_agent: getWorkflowUserAgent(),
      timestamp: new Date().toISOString(),
      instance_id: instanceId,
      execution_mode: 'streaming',
    },
    statistics: {
      total_node_count: nodeExecutionData.length,
      successful_nodes: nodeExecutionData.filter(
        node => node.status === 'succeeded'
      ).length,
      failed_nodes: nodeExecutionData.filter(node => node.status === 'failed')
        .length,
      total_node_tokens: nodeExecutionData.reduce(
        (sum, node) => sum + (node.total_tokens || 0),
        0
      ),
      total_node_elapsed_time: nodeExecutionData.reduce(
        (sum, node) => sum + (node.elapsed_time || 0),
        0
      ),
    },
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

function buildFailedWorkflowMetadata({
  errorMessage,
  rawErrorMessage,
  errorCode,
  errorKind,
  suggestion,
  requestId,
  nodeExecutionData,
  instanceId,
}: Omit<
  SaveFailedWorkflowExecutionDataParams,
  'currentExecutionId' | 'streamResponse' | 'updateCurrentExecution'
>): Record<string, unknown> {
  return {
    error_details: {
      message: errorMessage,
      raw_message: rawErrorMessage,
      code: errorCode,
      kind: errorKind,
      suggestion,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      collected_node_data: nodeExecutionData,
    },
    execution_context: {
      user_agent: getWorkflowUserAgent(),
      instance_id: instanceId,
      execution_mode: 'streaming',
    },
  };
}

export async function saveCompleteWorkflowExecutionData({
  executionId,
  finalResult,
  taskId,
  workflowRunId,
  nodeExecutionData = [],
  instanceId,
  updateCurrentExecution,
  addExecutionToHistory,
}: SaveCompleteWorkflowExecutionDataParams): Promise<Result<AppExecution>> {
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
    const finalResultError = finalResult.error || null;
    const normalizedFinalError = finalResultError
      ? toUserFacingAgentError({
          source: 'dify-workflow',
          message: finalResultError,
          locale: getWorkflowLocale(),
        })
      : null;
    const finalStatus: ExecutionStatus =
      finalResult.status === 'succeeded' ? 'completed' : 'failed';
    const completedAt = new Date().toISOString();

    console.log('[Workflow Execution] Ready to save complete data to database');

    const updateResult = await updateCompleteExecutionData(executionId, {
      status: finalStatus,
      external_execution_id: workflowRunId,
      task_id: taskId,
      outputs: finalResult.outputs,
      total_steps: finalResult.total_steps,
      total_tokens: finalResult.total_tokens ?? undefined,
      elapsed_time: finalResult.elapsed_time ?? undefined,
      error_message: normalizedFinalError?.userMessage || finalResultError,
      completed_at: completedAt,
      metadata: buildCompleteWorkflowMetadata(
        finalResult,
        nodeExecutionData,
        instanceId,
        normalizedFinalError
      ),
    });

    if (!updateResult.success) {
      console.error(
        '[Workflow Execution] ❌ Database update failed:',
        updateResult.error
      );
      return updateResult;
    }

    console.log('[Workflow Execution] ✅ Database update successful');
    conversationEvents.emit();

    updateCurrentExecution(updateResult.data);
    addExecutionToHistory(updateResult.data);

    return updateResult;
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
}

export async function saveFailedWorkflowExecutionData({
  currentExecutionId,
  rawErrorMessage,
  errorMessage,
  errorCode,
  errorKind,
  suggestion,
  requestId,
  nodeExecutionData,
  streamResponse,
  instanceId,
  updateCurrentExecution,
}: SaveFailedWorkflowExecutionDataParams): Promise<void> {
  console.log(
    '[Workflow Execution] Try to save error status and collected data'
  );

  let taskId: string | null = null;
  let workflowRunId: string | null = null;

  try {
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

  const completedAt = new Date().toISOString();
  const metadata = buildFailedWorkflowMetadata({
    errorMessage,
    rawErrorMessage,
    errorCode,
    errorKind,
    suggestion,
    requestId,
    nodeExecutionData,
    instanceId,
  });

  await updateCompleteExecutionData(currentExecutionId, {
    status: 'failed',
    error_message: errorMessage,
    completed_at: completedAt,
    external_execution_id: workflowRunId,
    task_id: taskId,
    metadata,
  });

  updateCurrentExecution({
    status: 'failed',
    error_message: errorMessage,
    completed_at: completedAt,
    external_execution_id: workflowRunId,
    task_id: taskId,
    metadata,
  });
  conversationEvents.emit();

  console.log('[Workflow Execution] ✅ Error status and data saved');
}
