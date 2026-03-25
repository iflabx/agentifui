import { parseSseStream } from '@lib/utils/sse-parser';

import {
  DifyWorkflowCompletionResponse,
  DifyWorkflowFinishedData,
  DifyWorkflowRequestPayload,
  DifyWorkflowSseEvent,
  DifyWorkflowStreamResponse,
} from '../types';
import { DIFY_API_BASE_URL } from './constants';
import { handleWorkflowApiError } from './errors';

function emitProgressUpdate(
  onProgressUpdate: ((event: DifyWorkflowSseEvent) => void) | undefined,
  event: DifyWorkflowSseEvent,
  label: string
) {
  if (!onProgressUpdate) {
    return;
  }

  try {
    onProgressUpdate(event);
  } catch (callbackError) {
    console.error(
      `[Dify Workflow Service] Error in onProgressUpdate callback (${label}):`,
      callbackError
    );
  }
}

export async function executeDifyWorkflow(
  payload: DifyWorkflowRequestPayload,
  appId: string
): Promise<DifyWorkflowCompletionResponse> {
  console.log(
    '[Dify Workflow Service] Executing workflow (blocking mode):',
    payload
  );

  const apiUrl = `${DIFY_API_BASE_URL}/${appId}/workflows/run`;
  const blockingPayload: DifyWorkflowRequestPayload = {
    ...payload,
    response_mode: 'blocking',
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(blockingPayload),
    });

    console.log(
      '[Dify Workflow Service] Received response status:',
      response.status
    );

    if (!response.ok) {
      let errorBody = 'Unknown error';
      try {
        errorBody = await response.text();
      } catch {
        // Ignore error when reading error body
      }
      throw handleWorkflowApiError(response.status, errorBody);
    }

    const result: DifyWorkflowCompletionResponse = await response.json();
    console.log(
      '[Dify Workflow Service] Workflow execution completed:',
      result.data.status
    );

    return result;
  } catch (error) {
    console.error(
      '[Dify Workflow Service] Error in executeDifyWorkflow:',
      error
    );
    throw error;
  }
}

export async function streamDifyWorkflow(
  payload: DifyWorkflowRequestPayload,
  appId: string,
  onProgressUpdate?: (event: DifyWorkflowSseEvent) => void
): Promise<DifyWorkflowStreamResponse> {
  console.log('[Dify Workflow Service] Starting workflow stream:', payload);

  const apiUrl = `${DIFY_API_BASE_URL}/${appId}/workflows/run`;
  const streamingPayload: DifyWorkflowRequestPayload = {
    ...payload,
    response_mode: 'streaming',
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(streamingPayload),
    });

    console.log(
      '[Dify Workflow Service] Received streaming response status:',
      response.status
    );

    if (!response.ok) {
      let errorBody = 'Unknown error';
      try {
        errorBody = await response.text();
      } catch {
        // Ignore error when reading error body
      }
      throw handleWorkflowApiError(response.status, errorBody);
    }

    if (!response.body) {
      throw new Error('Dify Workflow API response body is null.');
    }

    const stream = response.body;
    let workflowRunId: string | null = null;
    let taskId: string | null = null;
    let completionResolve: (value: DifyWorkflowFinishedData) => void;
    let completionReject: (reason: unknown) => void;

    const completionPromise = new Promise<DifyWorkflowFinishedData>(
      (resolve, reject) => {
        completionResolve = resolve;
        completionReject = reject;
      }
    );

    async function* processProgressStream(): AsyncGenerator<
      DifyWorkflowSseEvent,
      void,
      undefined
    > {
      try {
        for await (const result of parseSseStream(stream)) {
          if (result.type === 'error') {
            console.error(
              '[Dify Workflow Service] SSE Parser Error:',
              result.error
            );
            completionReject(new Error('Error parsing SSE stream.'));
            throw new Error('Error parsing SSE stream.');
          }

          const event = result.event as DifyWorkflowSseEvent;
          console.log(
            `[Dify Workflow Service] Received SSE event: ${event.event}`
          );

          if (event.workflow_run_id && !workflowRunId) {
            workflowRunId = event.workflow_run_id;
            console.log(
              '[Dify Workflow Service] Extracted workflowRunId:',
              workflowRunId
            );
          }
          if (event.task_id && !taskId) {
            taskId = event.task_id;
            console.log('[Dify Workflow Service] Extracted taskId:', taskId);
          }

          switch (event.event) {
            case 'workflow_started':
              console.log(
                '[Dify Workflow Service] Workflow started:',
                event.data.id
              );
              break;
            case 'node_started':
            case 'node_finished':
            case 'loop_started':
            case 'loop_next':
            case 'loop_completed':
            case 'iteration_started':
            case 'iteration_next':
            case 'iteration_completed':
              emitProgressUpdate(onProgressUpdate, event, event.event);
              yield event;
              break;
            case 'workflow_finished':
              console.log(
                '[Dify Workflow Service] Workflow finished:',
                event.data.status
              );
              completionResolve(event.data);
              return;
            case 'error':
              console.error(
                '[Dify Workflow Service] Workflow error:',
                event.message
              );
              const error = new Error(
                `Dify Workflow error: ${event.code} - ${event.message}`
              );
              completionReject(error);
              throw error;
            default:
              console.log(
                '[Dify Workflow Service] Ignoring unknown event type'
              );
              break;
          }
        }
      } catch (error) {
        console.error(
          '[Dify Workflow Service] Error in processProgressStream:',
          error
        );
        completionReject(error);
        throw error;
      }
    }

    return {
      progressStream: processProgressStream(),
      getWorkflowRunId: () => workflowRunId,
      getTaskId: () => taskId,
      completionPromise,
    };
  } catch (error) {
    console.error(
      '[Dify Workflow Service] Error in streamDifyWorkflow:',
      error
    );
    throw error;
  }
}

export async function stopDifyWorkflow(
  appId: string,
  taskId: string,
  user: string
): Promise<{ result: 'success' }> {
  console.log(
    `[Dify Workflow Service] Requesting to stop workflow task ${taskId} for app ${appId}`
  );

  const slug = `workflows/tasks/${taskId}/stop`;
  const apiUrl = `${DIFY_API_BASE_URL}/${appId}/${slug}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user }),
    });

    console.log(
      `[Dify Workflow Service] Stop workflow response status for ${taskId}:`,
      response.status
    );

    if (!response.ok) {
      let errorBody = 'Unknown error';
      try {
        errorBody = await response.text();
      } catch {}
      throw handleWorkflowApiError(response.status, errorBody);
    }

    const result = await response.json();
    console.log(
      `[Dify Workflow Service] Workflow task ${taskId} stopped successfully.`
    );
    return result;
  } catch (error) {
    console.error(
      `[Dify Workflow Service] Error stopping workflow task ${taskId}:`,
      error
    );
    throw error;
  }
}
