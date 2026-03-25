import { parseSseStream } from '@lib/utils/sse-parser';

import {
  DifyChatRequestPayload,
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
} from '../types';
import { DifyRetrieverResource } from '../types';
import { DIFY_API_BASE_URL } from './constants';
import {
  extractRetrieverResources,
  extractUsage,
  throwAppRequestError,
} from './helpers';

type NodeEvent =
  | DifySseNodeStartedEvent
  | DifySseNodeFinishedEvent
  | DifySseIterationStartedEvent
  | DifySseIterationNextEvent
  | DifySseIterationCompletedEvent
  | DifySseParallelBranchStartedEvent
  | DifySseParallelBranchFinishedEvent
  | DifySseLoopStartedEvent
  | DifySseLoopNextEvent
  | DifySseLoopCompletedEvent;

function emitNodeEvent(
  onNodeEvent: ((event: NodeEvent) => void) | undefined,
  event: NodeEvent,
  label: string
) {
  if (!onNodeEvent) {
    return;
  }

  try {
    onNodeEvent(event);
  } catch (callbackError) {
    console.error(
      `[Dify Service] Error in onNodeEvent callback (${label}):`,
      callbackError
    );
  }
}

function emitConversationId(
  onConversationIdReceived: ((id: string) => void) | undefined,
  conversationId: string,
  callbackCalledRef: { value: boolean },
  sourceLabel: string
) {
  if (!onConversationIdReceived || callbackCalledRef.value) {
    return;
  }

  try {
    onConversationIdReceived(conversationId);
    callbackCalledRef.value = true;
  } catch (callbackError) {
    console.error(
      `[Dify Service] Error in onConversationIdReceived callback (${sourceLabel}):`,
      callbackError
    );
  }
}

export async function streamDifyChat(
  payload: DifyChatRequestPayload,
  appId: string,
  onConversationIdReceived?: (id: string) => void,
  onNodeEvent?: (event: NodeEvent) => void
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

    if (!response.ok) {
      await throwAppRequestError(
        response,
        rawBody => `Dify API request failed (${response.status}): ${rawBody}`,
        () =>
          `Dify API request failed (${response.status}): ${response.statusText}`
      );
    }

    if (!response.body) {
      throw new Error('Dify API response body is null.');
    }

    const stream = response.body;
    let conversationId: string | null = null;
    let taskId: string | null = null;
    const callbackCalledRef = { value: false };

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

    async function* processStream(): AsyncGenerator<string, void, undefined> {
      try {
        for await (const result of parseSseStream(stream)) {
          if (result.type === 'error') {
            console.error('[Dify Service] SSE Parser Error:', result.error);
            completionReject(new Error('Error parsing SSE stream.'));
            throw new Error('Error parsing SSE stream.');
          }

          const event = result.event as DifySseEvent;

          if (event.event !== 'message') {
            console.log(
              `[Dify Service] 🎯 Received key SSE event: ${event.event}${event.event === 'message_end' ? ' (key event!)' : ''}`
            );
          }

          if (event.conversation_id) {
            if (!conversationId) {
              conversationId = event.conversation_id;
              emitConversationId(
                onConversationIdReceived,
                conversationId,
                callbackCalledRef,
                'stream'
              );
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
          if ('task_id' in event && event.task_id && !taskId) {
            taskId = event.task_id;
            console.log('[Dify Service] Extracted taskId:', taskId);
          }

          switch (event.event) {
            case 'agent_thought':
              console.log('[Dify Service] Agent thought event received');
              break;
            case 'agent_message':
              if (event.answer) {
                yield event.answer;
              }
              break;
            case 'node_started':
              console.log('[Dify Service] Node started:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseNodeStartedEvent,
                'node_started'
              );
              break;
            case 'node_finished':
              console.log('[Dify Service] Node finished:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseNodeFinishedEvent,
                'node_finished'
              );
              break;
            case 'iteration_started':
              console.log('[Dify Service] Iteration started:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseIterationStartedEvent,
                'iteration_started'
              );
              break;
            case 'iteration_next':
              console.log('[Dify Service] Iteration next:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseIterationNextEvent,
                'iteration_next'
              );
              break;
            case 'iteration_completed':
              console.log('[Dify Service] Iteration completed:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseIterationCompletedEvent,
                'iteration_completed'
              );
              break;
            case 'parallel_branch_started':
              console.log(
                '[Dify Service] Parallel branch started:',
                event.data
              );
              emitNodeEvent(
                onNodeEvent,
                event as DifySseParallelBranchStartedEvent,
                'parallel_branch_started'
              );
              break;
            case 'parallel_branch_finished':
              console.log(
                '[Dify Service] Parallel branch finished:',
                event.data
              );
              emitNodeEvent(
                onNodeEvent,
                event as DifySseParallelBranchFinishedEvent,
                'parallel_branch_finished'
              );
              break;
            case 'loop_started':
              console.log('[Dify Service] Loop started:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseLoopStartedEvent,
                'loop_started'
              );
              break;
            case 'loop_next':
              console.log('[Dify Service] Loop next:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseLoopNextEvent,
                'loop_next'
              );
              break;
            case 'loop_completed':
              console.log('[Dify Service] Loop completed:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseLoopCompletedEvent,
                'loop_completed'
              );
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
                emitConversationId(
                  onConversationIdReceived,
                  conversationId,
                  callbackCalledRef,
                  'message_end'
                );
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

    return {
      answerStream: processStream(),
      getConversationId: () => conversationId,
      getTaskId: () => taskId,
      completionPromise,
    };
  } catch (error) {
    console.error('[Dify Service] Error in streamDifyChat:', error);
    throw error;
  }
}
