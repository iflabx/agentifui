/**
 * Dify Chat Service
 * @description Implements interaction logic with Dify chat-related APIs
 * @module lib/services/dify/chat-service
 */
import {
  AppRequestError,
  extractAppErrorDetail,
  extractErrorMessage,
} from '@lib/errors/app-error';
import { parseSseStream } from '@lib/utils/sse-parser';

import {
  DifyChatRequestPayload,
  DifyRetrieverResource,
  DifySseEvent,
  DifySseIterationCompletedEvent,
  DifySseIterationNextEvent,
  DifySseIterationStartedEvent,
  DifySseLoopCompletedEvent,
  DifySseLoopNextEvent,
  DifySseLoopStartedEvent,
  DifySseNodeFinishedEvent,
  DifySseNodeStartedEvent,
  DifySseParallelBranchFinishedEvent,
  DifySseParallelBranchStartedEvent,
  DifyStreamResponse,
  DifyUsage,
} from './types';
/**
 * Type definitions for stopping Dify streaming tasks
 * @description Calls backend proxy to safely interact with Dify API
 * @see Dify docs: POST /chat-messages/:task_id/stop
 */
import { DifyStopTaskRequestPayload, DifyStopTaskResponse } from './types';

/** Dify API base URL (points to our backend proxy) */
const DIFY_API_BASE_URL = '/api/dify';

/**
 * Safely extract usage data with type checking
 * @param usage - Unknown usage data from API response
 * @returns Validated DifyUsage object or undefined
 */
const extractUsage = (usage: unknown): DifyUsage | undefined => {
  if (
    usage &&
    typeof usage === 'object' &&
    'total_tokens' in usage &&
    typeof (usage as { total_tokens: unknown }).total_tokens === 'number'
  ) {
    return usage as DifyUsage;
  }
  return undefined;
};

/**
 * Type guard to validate DifyRetrieverResource structure
 * @param resource - Unknown resource object
 * @returns True if resource matches DifyRetrieverResource interface
 */
const isRetrieverResource = (
  resource: unknown
): resource is DifyRetrieverResource => {
  if (!resource || typeof resource !== 'object') {
    return false;
  }

  const res = resource as Record<string, unknown>;

  return (
    typeof res.segment_id === 'string' &&
    typeof res.document_id === 'string' &&
    typeof res.document_name === 'string' &&
    typeof res.position === 'number' &&
    typeof res.content === 'string'
  );
};

/**
 * Normalize and filter retriever resources array
 * @param value - Unknown value to normalize
 * @returns Array of valid retriever resources
 */
const normalizeResources = (value: unknown): DifyRetrieverResource[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRetrieverResource);
};

/**
 * Extract retriever resources with fallback logic
 * @param preferred - Preferred source (event.metadata.retriever_resources)
 * @param fallback - Fallback source (event.retriever_resources)
 * @returns Array of valid retriever resources
 */
const extractRetrieverResources = (
  preferred: unknown,
  fallback: unknown
): DifyRetrieverResource[] => {
  const preferredResources = normalizeResources(preferred);
  return preferredResources.length
    ? preferredResources
    : normalizeResources(fallback);
};

/**
 * Calls Dify's chat-messages endpoint and handles streaming response
 *
 * @param payload - Request body sent to Dify API
 * @param appId - Dify application ID
 * @param onConversationIdReceived - Optional callback, called when conversationId is first extracted
 * @param onNodeEvent - Optional callback, called when a node event occurs
 * @returns A Promise containing an async generator (answerStream), conversationId, and taskId
 * @throws Throws if fetch fails or API returns error status
 */
export async function streamDifyChat(
  payload: DifyChatRequestPayload,
  appId: string,
  onConversationIdReceived?: (id: string) => void,
  onNodeEvent?: (
    event:
      | DifySseNodeStartedEvent
      | DifySseNodeFinishedEvent
      | DifySseIterationStartedEvent
      | DifySseIterationNextEvent
      | DifySseIterationCompletedEvent
      | DifySseParallelBranchStartedEvent
      | DifySseParallelBranchFinishedEvent
      | DifySseLoopStartedEvent
      | DifySseLoopNextEvent
      | DifySseLoopCompletedEvent
  ) => void
): Promise<DifyStreamResponse> {
  console.log('[Dify Service] Sending request to proxy:', payload);

  const apiUrl = `${DIFY_API_BASE_URL}/${appId}/chat-messages`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    console.log('[Dify Service] Received response status:', response.status);

    // Check response status, throw if not 2xx
    if (!response.ok) {
      let rawBody = '';
      try {
        rawBody = await response.text();
      } catch {
        // Ignore error when reading error body
      }
      let parsedBody: unknown = null;
      if (rawBody.trim().length > 0) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = null;
        }
      }

      const fallbackMessage =
        rawBody.trim().length > 0
          ? `Dify API request failed (${response.status}): ${rawBody}`
          : `Dify API request failed (${response.status}): ${response.statusText}`;
      const message = extractErrorMessage(parsedBody, fallbackMessage);
      throw new AppRequestError(
        message,
        response.status,
        extractAppErrorDetail(parsedBody)
      );
    }

    // Check if response body exists
    if (!response.body) {
      throw new Error('Dify API response body is null.');
    }

    const stream = response.body;
    let conversationId: string | null = null;
    let taskId: string | null = null;
    let conversationIdCallbackCalled = false;

    // Create completionPromise to capture metadata from message_end event
    let completionResolve: (value: {
      usage?: DifyUsage;
      metadata?: Record<string, unknown>;
      retrieverResources?: DifyRetrieverResource[];
    }) => void;
    let completionReject: (reason?: unknown) => void;
    let completionResolved = false;

    const completionPromise = new Promise<{
      usage?: DifyUsage;
      metadata?: Record<string, unknown>;
      retrieverResources?: DifyRetrieverResource[];
    }>((resolve, reject) => {
      completionResolve = resolve;
      completionReject = reject;
    });

    /**
     * Internal async generator to process streaming response
     * @description Parses SSE events and extracts required information
     */
    async function* processStream(): AsyncGenerator<string, void, undefined> {
      try {
        // Use sse-parser to parse the stream
        for await (const result of parseSseStream(stream)) {
          if (result.type === 'error') {
            // If SSE parser reports error, throw up
            console.error('[Dify Service] SSE Parser Error:', result.error);
            completionReject(new Error('Error parsing SSE stream.'));
            throw new Error('Error parsing SSE stream.');
          }

          // Handle successfully parsed event
          const event = result.event as DifySseEvent;

          // Filter message events, only log key events
          if (event.event !== 'message') {
            console.log(
              `[Dify Service] 🎯 Received key SSE event: ${event.event}${event.event === 'message_end' ? ' (key event!)' : ''}`
            );
          }

          // Extract conversation_id and task_id (usually in message_end event)
          if (event.conversation_id) {
            if (!conversationId) {
              conversationId = event.conversation_id;
              if (onConversationIdReceived && !conversationIdCallbackCalled) {
                try {
                  onConversationIdReceived(conversationId);
                  conversationIdCallbackCalled = true;
                } catch (callbackError) {
                  console.error(
                    '[Dify Service] Error in onConversationIdReceived callback:',
                    callbackError
                  );
                }
              } else if (conversationId !== event.conversation_id) {
                console.warn(
                  '[Dify Service] Warning: conversationId in event differs from saved one!',
                  {
                    saved: conversationId,
                    fromEvent: event.conversation_id,
                  }
                );
              }
            }
          }
          if ('task_id' in event && event.task_id && !taskId) {
            taskId = event.task_id;
            console.log('[Dify Service] Extracted taskId:', taskId);
          }

          // Handle by event type
          switch (event.event) {
            case 'agent_thought':
              // agent_thought event contains agent's thought process, but usually thought field is empty
              // This event mainly marks the start of thinking phase, no need to yield content
              console.log('[Dify Service] Agent thought event received');
              break;
            case 'agent_message':
              if (event.answer) {
                // agent_message event contains actual answer from agent application
                // Should be yielded like message event for frontend display
                yield event.answer;
              }
              break;
            case 'node_started':
              console.log('[Dify Service] Node started:', event.data);
              if (onNodeEvent) {
                try {
                  onNodeEvent(event as DifySseNodeStartedEvent);
                } catch (callbackError) {
                  console.error(
                    '[Dify Service] Error in onNodeEvent callback (node_started):',
                    callbackError
                  );
                }
              }
              break;
            case 'node_finished':
              console.log('[Dify Service] Node finished:', event.data);
              if (onNodeEvent) {
                try {
                  onNodeEvent(event as DifySseNodeFinishedEvent);
                } catch (callbackError) {
                  console.error(
                    '[Dify Service] Error in onNodeEvent callback (node_finished):',
                    callbackError
                  );
                }
              }
              break;
            case 'iteration_started':
              console.log('[Dify Service] Iteration started:', event.data);
              if (onNodeEvent) {
                try {
                  onNodeEvent(event as DifySseIterationStartedEvent);
                } catch (callbackError) {
                  console.error(
                    '[Dify Service] Error in onNodeEvent callback (iteration_started):',
                    callbackError
                  );
                }
              }
              break;
            case 'iteration_next':
              console.log('[Dify Service] Iteration next:', event.data);
              if (onNodeEvent) {
                try {
                  onNodeEvent(event as DifySseIterationNextEvent);
                } catch (callbackError) {
                  console.error(
                    '[Dify Service] Error in onNodeEvent callback (iteration_next):',
                    callbackError
                  );
                }
              }
              break;
            case 'iteration_completed':
              console.log('[Dify Service] Iteration completed:', event.data);
              if (onNodeEvent) {
                try {
                  onNodeEvent(event as DifySseIterationCompletedEvent);
                } catch (callbackError) {
                  console.error(
                    '[Dify Service] Error in onNodeEvent callback (iteration_completed):',
                    callbackError
                  );
                }
              }
              break;
            case 'parallel_branch_started':
              console.log(
                '[Dify Service] Parallel branch started:',
                event.data
              );
              if (onNodeEvent) {
                try {
                  onNodeEvent(event as DifySseParallelBranchStartedEvent);
                } catch (callbackError) {
                  console.error(
                    '[Dify Service] Error in onNodeEvent callback (parallel_branch_started):',
                    callbackError
                  );
                }
              }
              break;
            case 'parallel_branch_finished':
              console.log(
                '[Dify Service] Parallel branch finished:',
                event.data
              );
              if (onNodeEvent) {
                try {
                  onNodeEvent(event as DifySseParallelBranchFinishedEvent);
                } catch (callbackError) {
                  console.error(
                    '[Dify Service] Error in onNodeEvent callback (parallel_branch_finished):',
                    callbackError
                  );
                }
              }
              break;
            case 'loop_started':
              console.log('[Dify Service] Loop started:', event.data);
              if (onNodeEvent) {
                try {
                  onNodeEvent(event as DifySseLoopStartedEvent);
                } catch (callbackError) {
                  console.error(
                    '[Dify Service] Error in onNodeEvent callback (loop_started):',
                    callbackError
                  );
                }
              }
              break;
            case 'loop_next':
              console.log('[Dify Service] Loop next:', event.data);
              if (onNodeEvent) {
                try {
                  onNodeEvent(event as DifySseLoopNextEvent);
                } catch (callbackError) {
                  console.error(
                    '[Dify Service] Error in onNodeEvent callback (loop_next):',
                    callbackError
                  );
                }
              }
              break;
            case 'loop_completed':
              console.log('[Dify Service] Loop completed:', event.data);
              if (onNodeEvent) {
                try {
                  onNodeEvent(event as DifySseLoopCompletedEvent);
                } catch (callbackError) {
                  console.error(
                    '[Dify Service] Error in onNodeEvent callback (loop_completed):',
                    callbackError
                  );
                }
              }
              break;
            case 'message':
              if (event.answer) {
                yield event.answer;
              }
              break;
            case 'message_end':
              console.log(
                '[Dify Service] Received message_end event with metadata:',
                {
                  metadata: event.metadata,
                  usage: event.metadata?.usage || event.usage,
                  retrieverResources: event.metadata?.retriever_resources,
                }
              );

              if (event.conversation_id && !conversationId) {
                conversationId = event.conversation_id;
                console.log(
                  '[Dify Service] Extracted conversationId from message_end:',
                  conversationId
                );
                if (onConversationIdReceived && !conversationIdCallbackCalled) {
                  try {
                    onConversationIdReceived(conversationId);
                    conversationIdCallbackCalled = true;
                  } catch (callbackError) {
                    console.error(
                      '[Dify Service] Error in onConversationIdReceived callback (message_end):',
                      callbackError
                    );
                  }
                }
              }
              if (event.task_id && !taskId) {
                taskId = event.task_id;
                console.log(
                  '[Dify Service] Extracted taskId from message_end:',
                  taskId
                );
              }

              const completionData = {
                usage: extractUsage(event.metadata?.usage || event.usage),
                metadata: event.metadata || {},
                retrieverResources: extractRetrieverResources(
                  event.metadata?.retriever_resources,
                  event.retriever_resources
                ),
              };

              console.log(
                '[Dify Service] Resolving completionPromise with data:',
                completionData
              );
              if (!completionResolved) {
                completionResolve(completionData);
                completionResolved = true;
              }

              console.log('[Dify Service] Message stream ended.');
              break;
            case 'error':
              console.error('[Dify Service] Dify API Error Event:', event);
              const errorInfo = new Error(
                `Dify API error: ${event.code} - ${event.message}`
              );
              completionReject(errorInfo);
              throw errorInfo;
            default:
              break;
          }
        }
        console.log('[Dify Service] Finished processing stream.');

        if (completionResolve && !completionResolved) {
          console.log(
            '[Dify Service] Stream ended without message_end, resolving with empty data'
          );
          completionResolve({
            usage: undefined,
            metadata: {},
            retrieverResources: [],
          });
          completionResolved = true;
        }
      } catch (error) {
        console.error('[Dify Service] Error in processStream:', error);
        if (completionReject) {
          completionReject(
            error instanceof Error ? error : new Error(String(error))
          );
        }
        throw error;
      }
    }

    const responsePayload: DifyStreamResponse = {
      answerStream: processStream(),
      getConversationId: () => conversationId,
      getTaskId: () => taskId,
      completionPromise,
    };

    return responsePayload;
  } catch (error) {
    console.error('[Dify Service] Error in streamDifyChat:', error);
    throw error;
  }
}

/**
 * Request to stop a Dify streaming chat task.
 *
 * @param appId - Dify application ID.
 * @param taskId - Task ID to stop (obtained from streaming response).
 * @param user - User identifier who initiated the request, must match the one who started the task.
 * @returns A Promise resolving to DifyStopTaskResponse (contains { result: 'success' }).
 * @throws Throws if request fails or API returns error status.
 */
export async function stopDifyStreamingTask(
  appId: string,
  taskId: string,
  user: string
): Promise<DifyStopTaskResponse> {
  console.log(
    `[Dify Service] Requesting to stop task ${taskId} for app ${appId} and user ${user}`
  );

  const slug = `chat-messages/${taskId}/stop`;
  const apiUrl = `${DIFY_API_BASE_URL}/${appId}/${slug}`;

  const payload: DifyStopTaskRequestPayload = {
    user: user,
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    console.log(
      `[Dify Service] Stop task response status for ${taskId}:`,
      response.status
    );

    if (!response.ok) {
      let rawBody = '';
      try {
        rawBody = await response.text();
      } catch {
        // Ignore error when reading error body
      }
      let parsedBody: unknown = null;
      if (rawBody.trim().length > 0) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = null;
        }
      }
      const fallbackMessage =
        rawBody.trim().length > 0
          ? `Failed to stop Dify task ${taskId}. ${rawBody}`
          : `Failed to stop Dify task ${taskId}. ${response.status} ${response.statusText}`;
      const message = extractErrorMessage(parsedBody, fallbackMessage);
      throw new AppRequestError(
        message,
        response.status,
        extractAppErrorDetail(parsedBody)
      );
    }

    const result: DifyStopTaskResponse = await response.json();

    if (result.result !== 'success') {
      console.warn(
        `[Dify Service] Stop task for ${taskId} returned success status but unexpected body:`,
        result
      );
    }

    console.log(`[Dify Service] Task ${taskId} stopped successfully.`);
    return result;
  } catch (error) {
    console.error(`[Dify Service] Error stopping task ${taskId}:`, error);
    throw error;
  }
}
