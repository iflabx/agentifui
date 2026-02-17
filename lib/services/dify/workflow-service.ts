// lib/services/dify/workflow-service.ts
// Implements interaction logic with Dify Workflow API.
// Reference: POST /workflows/run
import { parseSseStream } from '@lib/utils/sse-parser';

import {
  DifyApiError,
  DifyWorkflowCompletionResponse,
  DifyWorkflowErrorCode,
  DifyWorkflowFinishedData,
  DifyWorkflowRequestPayload,
  DifyWorkflowRunDetailResponse,
  DifyWorkflowSseEvent,
  DifyWorkflowStreamResponse,
  GetDifyWorkflowLogsParams,
  GetDifyWorkflowLogsResponse,
} from './types';

// Define Dify API base URL (points to our backend proxy)
const DIFY_API_BASE_URL = '/api/dify'; // Proxy base path

/**
 * Handle Dify Workflow API error response
 */
function handleWorkflowApiError(status: number, errorBody: string): Error {
  try {
    const errorData = JSON.parse(errorBody) as DifyApiError;
    const errorCode = errorData.code as DifyWorkflowErrorCode;

    // Provide more user-friendly error messages based on error code
    const errorMessages: Record<DifyWorkflowErrorCode, string> = {
      invalid_param: 'Request parameter error, please check input parameters',
      app_unavailable: 'App unavailable, please check app status',
      provider_not_initialize: 'Model provider not initialized',
      provider_quota_exceeded: 'Model provider quota exceeded',
      model_currently_not_support:
        'Current model does not support this operation',
      workflow_request_error: 'Workflow request error',
    };

    const friendlyMessage =
      errorMessages[errorCode] || errorData.message || 'Unknown error';
    return new Error(`Dify Workflow API Error (${status}): ${friendlyMessage}`);
  } catch (parseError) {
    // If unable to parse error response, return raw error info
    return new Error(
      `Dify Workflow API request failed (${status}): ${errorBody}`
    );
  }
}

/**
 * Execute Dify Workflow (blocking mode)
 *
 * @param payload - Request body sent to Dify Workflow API
 * @param appId - Dify app ID
 * @returns A Promise containing the full execution result
 * @throws Throws error if fetch fails or API returns error status
 */
export async function executeDifyWorkflow(
  payload: DifyWorkflowRequestPayload,
  appId: string
): Promise<DifyWorkflowCompletionResponse> {
  console.log(
    '[Dify Workflow Service] Executing workflow (blocking mode):',
    payload
  );

  const apiUrl = `${DIFY_API_BASE_URL}/${appId}/workflows/run`;

  // Ensure blocking mode is used
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

/**
 * Execute Dify Workflow (streaming mode)
 *
 * @param payload - Request body sent to Dify Workflow API
 * @param appId - Dify app ID
 * @param onProgressUpdate - Optional callback, called when node status updates
 * @returns An object containing the progress stream and completion Promise
 * @throws Throws error if fetch fails or API returns error status
 */
export async function streamDifyWorkflow(
  payload: DifyWorkflowRequestPayload,
  appId: string,
  onProgressUpdate?: (event: DifyWorkflowSseEvent) => void
): Promise<DifyWorkflowStreamResponse> {
  console.log('[Dify Workflow Service] Starting workflow stream:', payload);

  const apiUrl = `${DIFY_API_BASE_URL}/${appId}/workflows/run`;

  // Ensure streaming mode is used
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

    // Create completion Promise
    const completionPromise = new Promise<DifyWorkflowFinishedData>(
      (resolve, reject) => {
        completionResolve = resolve;
        completionReject = reject;
      }
    );

    // Create progress stream generator
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

          // Extract workflow_run_id and task_id
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

          // Handle different event types
          switch (event.event) {
            case 'workflow_started':
              console.log(
                '[Dify Workflow Service] Workflow started:',
                event.data.id
              );
              break;

            case 'node_started':
              console.log(
                '[Dify Workflow Service] Node started:',
                event.data.node_id,
                event.data.title
              );
              if (onProgressUpdate) {
                try {
                  onProgressUpdate(event);
                } catch (callbackError) {
                  console.error(
                    '[Dify Workflow Service] Error in onProgressUpdate callback:',
                    callbackError
                  );
                }
              }
              yield event;
              break;

            case 'node_finished':
              console.log(
                '[Dify Workflow Service] Node finished:',
                event.data.node_id,
                event.data.status
              );
              if (onProgressUpdate) {
                try {
                  onProgressUpdate(event);
                } catch (callbackError) {
                  console.error(
                    '[Dify Workflow Service] Error in onProgressUpdate callback:',
                    callbackError
                  );
                }
              }
              yield event;
              break;

            // Loop event handling
            case 'loop_started':
              console.log(
                '[Dify Workflow Service] Loop started:',
                event.data.node_id,
                event.data.title
              );
              if (onProgressUpdate) {
                try {
                  onProgressUpdate(event);
                } catch (callbackError) {
                  console.error(
                    '[Dify Workflow Service] Error in onProgressUpdate callback (loop_started):',
                    callbackError
                  );
                }
              }
              yield event;
              break;

            case 'loop_next':
              console.log(
                '[Dify Workflow Service] Loop next:',
                event.data.node_id,
                'index:',
                event.data.index
              );
              if (onProgressUpdate) {
                try {
                  onProgressUpdate(event);
                } catch (callbackError) {
                  console.error(
                    '[Dify Workflow Service] Error in onProgressUpdate callback (loop_next):',
                    callbackError
                  );
                }
              }
              yield event;
              break;

            case 'loop_completed':
              console.log(
                '[Dify Workflow Service] Loop completed:',
                event.data.node_id
              );
              if (onProgressUpdate) {
                try {
                  onProgressUpdate(event);
                } catch (callbackError) {
                  console.error(
                    '[Dify Workflow Service] Error in onProgressUpdate callback (loop_completed):',
                    callbackError
                  );
                }
              }
              yield event;
              break;

            // Iteration event handling
            case 'iteration_started':
              console.log(
                '[Dify Workflow Service] Iteration started:',
                event.data.node_id,
                event.data.title
              );
              if (onProgressUpdate) {
                try {
                  onProgressUpdate(event);
                } catch (callbackError) {
                  console.error(
                    '[Dify Workflow Service] Error in onProgressUpdate callback (iteration_started):',
                    callbackError
                  );
                }
              }
              yield event;
              break;

            case 'iteration_next':
              console.log(
                '[Dify Workflow Service] Iteration next:',
                event.data.node_id,
                'index:',
                event.data.iteration_index
              );
              if (onProgressUpdate) {
                try {
                  onProgressUpdate(event);
                } catch (callbackError) {
                  console.error(
                    '[Dify Workflow Service] Error in onProgressUpdate callback (iteration_next):',
                    callbackError
                  );
                }
              }
              yield event;
              break;

            case 'iteration_completed':
              console.log(
                '[Dify Workflow Service] Iteration completed:',
                event.data.node_id
              );
              if (onProgressUpdate) {
                try {
                  onProgressUpdate(event);
                } catch (callbackError) {
                  console.error(
                    '[Dify Workflow Service] Error in onProgressUpdate callback (iteration_completed):',
                    callbackError
                  );
                }
              }
              yield event;
              break;

            case 'workflow_finished':
              console.log(
                '[Dify Workflow Service] Workflow finished:',
                event.data.status
              );
              completionResolve(event.data);
              return; // End generator

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

    const responsePayload: DifyWorkflowStreamResponse = {
      progressStream: processProgressStream(),
      getWorkflowRunId: () => workflowRunId,
      getTaskId: () => taskId,
      completionPromise,
    };

    return responsePayload;
  } catch (error) {
    console.error(
      '[Dify Workflow Service] Error in streamDifyWorkflow:',
      error
    );
    throw error;
  }
}

/**
 * Stop Dify Workflow execution
 *
 * @param appId - Dify app ID
 * @param taskId - Task ID to stop
 * @param user - User identifier who initiates the request
 * @returns A Promise representing the stop operation result
 * @throws Throws error if request fails or API returns error status
 */
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

  const payload = { user };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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

/**
 * Get workflow run detail
 *
 * @param appId - App ID
 * @param workflowRunId - Workflow run ID
 * @returns Promise<DifyWorkflowRunDetailResponse> - Workflow run detail
 */
export async function getDifyWorkflowRunDetail(
  appId: string,
  workflowRunId: string
): Promise<DifyWorkflowRunDetailResponse> {
  const slug = `workflows/run/${workflowRunId}`; // Dify API path
  const apiUrl = `/api/dify/${appId}/${slug}`; // Points to backend proxy

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // No Authorization header needed, handled by proxy
    });

    if (!response.ok) {
      // Handle 404 error
      if (response.status === 404) {
        throw new Error('Workflow run record not found');
      }

      // Try to parse error response
      let errorData: DifyApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          status: response.status,
          code: response.status.toString(),
          message: response.statusText || 'Failed to get workflow run detail',
        };
      }

      console.error(
        '[Dify Workflow Service] Failed to get workflow run detail:',
        errorData
      );
      throw new Error(
        `Failed to get workflow run detail: ${errorData.message}`
      );
    }

    const result: DifyWorkflowRunDetailResponse = await response.json();

    console.log(
      '[Dify Workflow Service] Successfully got workflow run detail:',
      {
        appId,
        workflowRunId,
        status: result.status,
        totalSteps: result.total_steps,
        totalTokens: result.total_tokens,
      }
    );

    return result;
  } catch (error) {
    console.error(
      '[Dify Workflow Service] Error occurred while getting workflow run detail:',
      error
    );

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unknown error occurred while getting workflow run detail');
  }
}

// Get Workflow logs
// GET /workflows/logs
/**
 * Get workflow log list
 * Returns workflow logs in descending order
 *
 * @param appId - App ID
 * @param params - Query parameters
 * @returns Promise<GetDifyWorkflowLogsResponse> - Workflow log list
 */
export async function getDifyWorkflowLogs(
  appId: string,
  params?: GetDifyWorkflowLogsParams
): Promise<GetDifyWorkflowLogsResponse> {
  const slug = 'workflows/logs'; // Dify API path

  // Build query parameters
  const searchParams = new URLSearchParams();
  if (params?.keyword) {
    searchParams.append('keyword', params.keyword);
  }
  if (params?.status) {
    searchParams.append('status', params.status);
  }
  if (params?.page) {
    searchParams.append('page', params.page.toString());
  }
  if (params?.limit) {
    searchParams.append('limit', params.limit.toString());
  }

  const queryString = searchParams.toString();
  const apiUrl = `/api/dify/${appId}/${slug}${queryString ? `?${queryString}` : ''}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // No Authorization header needed, handled by proxy
    });

    if (!response.ok) {
      // Try to parse error response
      let errorData: DifyApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          status: response.status,
          code: response.status.toString(),
          message: response.statusText || 'Failed to get workflow logs',
        };
      }

      console.error(
        '[Dify Workflow Service] Failed to get workflow logs:',
        errorData
      );
      throw new Error(`Failed to get workflow logs: ${errorData.message}`);
    }

    const result: GetDifyWorkflowLogsResponse = await response.json();

    console.log('[Dify Workflow Service] Successfully got workflow logs:', {
      appId,
      params,
      page: result.page,
      limit: result.limit,
      total: result.total,
      dataCount: result.data.length,
      hasMore: result.has_more,
    });

    return result;
  } catch (error) {
    console.error(
      '[Dify Workflow Service] Error occurred while getting workflow logs:',
      error
    );

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unknown error occurred while getting workflow logs');
  }
}
