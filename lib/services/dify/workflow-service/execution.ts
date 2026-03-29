import { parseSseStream } from '@lib/utils/sse-parser';

import {
  DifyWorkflowCompletionResponse,
  DifyWorkflowFinishedData,
  DifyWorkflowRequestPayload,
  DifyWorkflowRunDetailResponse,
  DifyWorkflowSseEvent,
  DifyWorkflowStreamResponse,
} from '../types';
import { DIFY_API_BASE_URL } from './constants';
import { handleWorkflowApiError } from './errors';
import { getDifyWorkflowRunDetail } from './query';

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

const WORKFLOW_RUN_DETAIL_RETRY_DELAYS_MS = [0, 400, 1200] as const;

function isTerminalWorkflowStatus(
  status: DifyWorkflowFinishedData['status']
): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'stopped';
}

function toWorkflowFinishedData(
  runDetail: DifyWorkflowRunDetailResponse
): DifyWorkflowFinishedData {
  return {
    id: runDetail.id,
    workflow_id: runDetail.workflow_id,
    status: runDetail.status,
    outputs: runDetail.outputs,
    error: runDetail.error,
    elapsed_time: runDetail.elapsed_time,
    total_tokens: runDetail.total_tokens,
    total_steps: runDetail.total_steps,
    created_at: runDetail.created_at,
    finished_at: runDetail.finished_at ?? runDetail.created_at,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    let completionSettled = false;
    let completionResolve: (value: DifyWorkflowFinishedData) => void;
    let completionReject: (reason: unknown) => void;

    const completionPromise = new Promise<DifyWorkflowFinishedData>(
      (resolve, reject) => {
        completionResolve = resolve;
        completionReject = reject;
      }
    );

    const resolveCompletion = (value: DifyWorkflowFinishedData) => {
      if (completionSettled) {
        return;
      }
      completionSettled = true;
      completionResolve(value);
    };

    const rejectCompletion = (reason: unknown) => {
      if (completionSettled) {
        return;
      }
      completionSettled = true;
      completionReject(reason);
    };

    let recoveryPromise: Promise<DifyWorkflowFinishedData | null> | null = null;

    const recoverTerminalResult =
      async (): Promise<DifyWorkflowFinishedData | null> => {
        if (!workflowRunId) {
          return null;
        }

        if (recoveryPromise) {
          return recoveryPromise;
        }

        recoveryPromise = (async () => {
          for (const delayMs of WORKFLOW_RUN_DETAIL_RETRY_DELAYS_MS) {
            if (delayMs > 0) {
              await sleep(delayMs);
            }

            try {
              const runDetail = await getDifyWorkflowRunDetail(
                appId,
                workflowRunId
              );

              if (isTerminalWorkflowStatus(runDetail.status)) {
                console.warn(
                  '[Dify Workflow Service] Recovered terminal workflow status from run detail:',
                  runDetail.status
                );
                return toWorkflowFinishedData(runDetail);
              }

              console.warn(
                '[Dify Workflow Service] Workflow run detail still not terminal during recovery:',
                runDetail.status
              );
            } catch (recoveryError) {
              console.warn(
                '[Dify Workflow Service] Failed to recover workflow run detail:',
                recoveryError
              );
            }
          }

          return null;
        })();

        return recoveryPromise;
      };

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
            rejectCompletion(new Error('Error parsing SSE stream.'));
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
              resolveCompletion(event.data);
              return;
            case 'error':
              console.error(
                '[Dify Workflow Service] Workflow error:',
                event.message
              );
              const error = new Error(
                `Dify Workflow error: ${event.code} - ${event.message}`
              );
              rejectCompletion(error);
              throw error;
            default:
              console.log(
                '[Dify Workflow Service] Ignoring unknown event type'
              );
              break;
          }
        }

        if (!completionSettled) {
          const recoveredResult = await recoverTerminalResult();

          if (recoveredResult) {
            resolveCompletion(recoveredResult);
            return;
          }

          const streamEndedError = new Error(
            'Workflow stream ended before workflow_finished.'
          );
          rejectCompletion(streamEndedError);
          throw streamEndedError;
        }
      } catch (error) {
        if (!completionSettled) {
          const recoveredResult = await recoverTerminalResult();
          if (recoveredResult) {
            resolveCompletion(recoveredResult);
            return;
          }
        }

        console.error(
          '[Dify Workflow Service] Error in processProgressStream:',
          error
        );
        rejectCompletion(error);
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
