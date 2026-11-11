// lib/services/dify/completion-service.ts
/**
 * Dify Text Generation Service
 * @description Handles API interactions related to Dify text generation applications.
 * The text generation app uses the completion-messages endpoint instead of chat-messages.
 */
import { parseSseStream } from '@lib/utils/sse-parser';

import { extractUsage } from './chat-service/helpers';
import type {
  DifyApiError,
  DifyCompletionRequestPayload,
  DifyCompletionResponse,
  DifyCompletionStreamResponse,
} from './types';

/**
 * Execute text generation (blocking mode).
 *
 * @param appId - Application ID
 * @param payload - Request payload
 * @returns Promise<DifyCompletionResponse> - Generation result
 */
export async function executeDifyCompletion(
  appId: string,
  payload: DifyCompletionRequestPayload
): Promise<DifyCompletionResponse> {
  const slug = 'completion-messages'; // Text-Generation API endpoint
  const apiUrl = `/api/dify/${appId}/${slug}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, response_mode: 'blocking' }),
    });

    if (!response.ok) {
      let errorData: DifyApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          status: response.status,
          code: response.status.toString(),
          message: response.statusText || 'Text generation failed',
        };
      }

      console.error(
        '[Dify Completion Service] Text generation failed:',
        errorData
      );
      throw new Error(`Text generation failed: ${errorData.message}`);
    }

    const result: DifyCompletionResponse = await response.json();

    console.log('[Dify Completion Service] Text generated successfully:', {
      appId,
      messageId: result.message_id,
      answerLength: result.answer.length,
    });

    return {
      ...result,
      usage: extractUsage(result.metadata?.usage) ?? extractUsage(result.usage),
    };
  } catch (error) {
    console.error(
      '[Dify Completion Service] Error occurred during text generation:',
      error
    );

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unknown error occurred during text generation');
  }
}

/**
 * Streamed text generation.
 *
 * @param appId - Application ID
 * @param payload - Request payload
 * @returns Promise<DifyCompletionStreamResponse> - Streamed response
 */
export async function streamDifyCompletion(
  appId: string,
  payload: DifyCompletionRequestPayload
): Promise<DifyCompletionStreamResponse> {
  const slug = 'completion-messages'; // Text-Generation API endpoint
  const apiUrl = `/api/dify/${appId}/${slug}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, response_mode: 'streaming' }),
    });

    if (!response.ok) {
      let errorData: DifyApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          status: response.status,
          code: response.status.toString(),
          message: response.statusText || 'Streamed text generation failed',
        };
      }

      console.error(
        '[Dify Completion Service] Streamed text generation failed:',
        errorData
      );
      throw new Error(`Streamed text generation failed: ${errorData.message}`);
    }

    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const stream = response.body;
    let messageId: string | null = null;
    let taskId: string | null = null;
    let hasPreferredMessageId = false;
    let completionSettled = false;
    let streamStarted = false;

    type CompletionResult = Awaited<
      DifyCompletionStreamResponse['completionPromise']
    >;
    let completionResolve: (value: CompletionResult) => void;
    let completionReject: (reason: unknown) => void;

    const completionPromise = new Promise<CompletionResult>(
      (resolve, reject) => {
        completionResolve = resolve;
        completionReject = reject;
      }
    );
    void completionPromise.catch(() => undefined);

    const rejectIncompleteCompletion = () => {
      if (!completionSettled) {
        completionSettled = true;
        completionReject(
          new Error('Completion stream was closed before completion.')
        );
      }
    };

    async function* generateAnswerStream(): AsyncGenerator<
      string,
      void,
      undefined
    > {
      streamStarted = true;
      let hasReceivedContent = false;

      const resolveCompletion = (
        metadata: Record<string, unknown>,
        usage?: CompletionResult['usage']
      ) => {
        completionSettled = true;
        completionResolve({
          usage,
          metadata: {
            ...metadata,
            has_content: hasReceivedContent,
            message_id: messageId,
            task_id: taskId,
          },
        });
      };

      try {
        for await (const result of parseSseStream(stream)) {
          if (result.type === 'error') {
            throw result.error;
          }

          const event = result.event;
          if (typeof event.task_id === 'string' && event.task_id) {
            taskId = event.task_id;
          }

          if (event.event === 'error') {
            throw new Error(event.message || 'Dify completion stream failed.');
          }

          if (event.event !== 'message' && event.event !== 'message_end') {
            continue;
          }

          const preferredId =
            'message_id' in event ? event.message_id : undefined;
          if (typeof preferredId === 'string' && preferredId) {
            messageId = preferredId;
            hasPreferredMessageId = true;
          } else if (
            !hasPreferredMessageId &&
            typeof event.id === 'string' &&
            event.id
          ) {
            messageId = event.id;
          }

          if (event.event === 'message') {
            if (typeof event.answer !== 'string') {
              throw new Error(
                'Invalid completion message: answer must be a string.'
              );
            }
            hasReceivedContent ||= event.answer.length > 0;
            yield event.answer;
          } else {
            resolveCompletion(
              event.metadata || {},
              extractUsage(event.metadata?.usage) ?? extractUsage(event.usage)
            );
            return;
          }
        }

        resolveCompletion({ stream_completed: true });
      } catch (error) {
        const streamError =
          error instanceof Error ? error : new Error(String(error));
        if (!completionSettled) {
          completionSettled = true;
          completionReject(streamError);
        }
        throw streamError;
      } finally {
        rejectIncompleteCompletion();
      }
    }

    const answerStream = generateAnswerStream();
    const returnAnswerStream = answerStream.return.bind(answerStream);
    answerStream.return = async value => {
      if (!streamStarted && !completionSettled) {
        rejectIncompleteCompletion();
        await stream.cancel();
      }
      return returnAnswerStream(value);
    };

    return {
      answerStream,
      getMessageId: () => messageId,
      getTaskId: () => taskId,
      completionPromise,
    };
  } catch (error) {
    console.error(
      '[Dify Completion Service] Error occurred during streamed text generation:',
      error
    );

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unknown error occurred during streamed text generation');
  }
}

/**
 * Stop text generation task.
 *
 * @param appId - Application ID
 * @param taskId - Task ID
 * @param user - User identifier
 * @returns Promise<{ result: 'success' }> - Stop result
 */
export async function stopDifyCompletion(
  appId: string,
  taskId: string,
  user: string
): Promise<{ result: 'success' }> {
  const slug = `completion-messages/${taskId}/stop`;
  const apiUrl = `/api/dify/${appId}/${slug}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user }),
    });

    if (!response.ok) {
      let errorData: DifyApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          status: response.status,
          code: response.status.toString(),
          message: response.statusText || 'Failed to stop task',
        };
      }

      console.error(
        '[Dify Completion Service] Failed to stop task:',
        errorData
      );
      throw new Error(`Failed to stop task: ${errorData.message}`);
    }

    const result = await response.json();

    console.log('[Dify Completion Service] Task stopped successfully:', {
      appId,
      taskId,
    });

    return result;
  } catch (error) {
    console.error(
      '[Dify Completion Service] Error occurred while stopping task:',
      error
    );

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unknown error occurred while stopping task');
  }
}
