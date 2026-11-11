/**
 * Dify Conversation Service
 * @description Handles API interactions related to Dify conversations, such as fetching the conversation list.
 * Follows a similar design pattern as message-service.ts and chat-service.ts,
 * i.e., provides independent, exportable service functions.
 */
import type {
  DeleteConversationRequestPayload,
  DeleteConversationResponse,
  DifyApiError,
  GetConversationVariablesParams,
  GetConversationVariablesResponse,
  GetConversationsParams,
  GetConversationsResponse,
  RenameConversationRequestPayload,
  RenameConversationResponse,
} from './types';

// Define the base URL pointing to our backend Dify proxy API.
// Keep consistent with other services for unified proxy path management.
const DIFY_PROXY_BASE_URL = '/api/dify';

/**
 * Fetch the user's conversation list.
 *
 * Works by sending a request to the backend Dify proxy service.
 * Supports pagination via `last_id` and `limit` parameters.
 * Supports sorting via the `sort_by` parameter.
 *
 * @param appId - The current Dify application's ID.
 * @param params - An object containing `user`, and optionally `last_id`, `limit`, and `sort_by`.
 * @returns A Promise resolving to a `GetConversationsResponse` object, which contains the conversation list and pagination info.
 * @throws If the request fails or the API returns a non-2xx status code, throws an error object (similar to DifyApiError).
 */
export async function getConversations(
  appId: string,
  params: GetConversationsParams
): Promise<GetConversationsResponse> {
  if (!appId) {
    console.warn(
      '[Dify Conversation Service] Warning: appId is not provided. API call may fail or use a default app.'
    );
    // Or throw an error according to business requirements
    // throw new Error('[Dify Conversation Service] appId is required.');
  }

  const slug = 'conversations'; // Endpoint path in Dify API for fetching conversation list
  const apiUrl = `${DIFY_PROXY_BASE_URL}/${appId}/${slug}`;

  // Build query parameter string
  const queryParams = new URLSearchParams();
  queryParams.append('user', params.user);

  if (params.limit !== undefined) {
    queryParams.append('limit', String(params.limit));
  }
  if (params.last_id) {
    queryParams.append('last_id', params.last_id);
  }
  if (params.sort_by !== undefined) {
    queryParams.append('sort_by', params.sort_by);
  }

  const fullUrl = `${apiUrl}?${queryParams.toString()}`;

  console.log(
    `[Dify Conversation Service] Fetching conversations from: ${fullUrl}`
  );

  try {
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json', // Expect JSON response
      },
    });

    if (!response.ok) {
      // Try to parse error response body for more detailed error info
      let errorData: DifyApiError | { message: string; code?: string } = {
        message: `API request failed with status ${response.status}: ${response.statusText}`,
      };
      try {
        // Try to parse error response as JSON. Dify error responses are usually JSON.
        const parsedError = await response.json();
        errorData = {
          status: response.status,
          code: parsedError.code || response.status.toString(),
          message: parsedError.message || response.statusText,
          ...parsedError, // Include other possible error fields
        };
      } catch (e) {
        // If error response body is not valid JSON, use HTTP status text as message.
        console.warn(
          '[Dify Conversation Service] Failed to parse error response JSON.',
          e
        );
      }

      console.error(
        `[Dify Conversation Service] Failed to get conversations (${response.status}):`,
        errorData
      );
      // Throw error object, upper caller can catch and handle
      throw errorData;
    }

    // On success, parse JSON data
    const data: GetConversationsResponse = await response.json();
    console.log(
      '[Dify Conversation Service] Successfully fetched conversations.',
      data
    );
    return data;
  } catch (error) {
    // Handle network errors from fetch or other uncaught errors in try block
    console.error(
      '[Dify Conversation Service] Network or unexpected error while fetching conversations:',
      error
    );
    // Rethrow error, or wrap as a standardized error object
    // If error is already our errorData structure, just throw it
    if (
      error &&
      typeof error === 'object' &&
      ('status' in error || 'message' in error)
    ) {
      throw error;
    }
    // Otherwise, wrap as a generic error structure
    throw {
      message:
        error instanceof Error ? error.message : 'An unexpected error occurred',
      code: 'NETWORK_ERROR',
    } as DifyApiError;
  }
}

/**
 * Delete a specific conversation.
 *
 * Works by sending a DELETE request to the backend Dify proxy service.
 * On success, returns { result: 'success' }.
 *
 * @param appId - The current Dify application's ID.
 * @param conversationId - The ID of the conversation to delete.
 * @param payload - An object containing `user`, used to identify the user.
 * @returns A Promise resolving to a `DeleteConversationResponse` object, indicating the result.
 * @throws If the request fails or the API returns a non-2xx status code, throws an error object (similar to DifyApiError).
 */
export async function deleteConversation(
  appId: string,
  conversationId: string,
  payload: DeleteConversationRequestPayload
): Promise<DeleteConversationResponse> {
  if (!appId) {
    console.warn(
      '[Dify Conversation Service] Warning: appId is not provided. API call may fail or use a default app.'
    );
  }

  if (!conversationId) {
    throw new Error('[Dify Conversation Service] conversationId is required.');
  }

  const slug = `conversations/${conversationId}`; // Endpoint path in Dify API for deleting a specific conversation
  const apiUrl = `${DIFY_PROXY_BASE_URL}/${appId}/${slug}`;

  console.log(
    `[Dify Conversation Service] Deleting conversation: ${conversationId}`
  );

  try {
    const response = await fetch(apiUrl, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Try to parse error response body for more detailed error info
      let errorData: DifyApiError | { message: string; code?: string } = {
        message: `API request failed with status ${response.status}: ${response.statusText}`,
      };
      try {
        // Try to parse error response as JSON. Dify error responses are usually JSON.
        const parsedError = await response.json();
        errorData = {
          status: response.status,
          code: parsedError.code || response.status.toString(),
          message: parsedError.message || response.statusText,
          ...parsedError, // Include other possible error fields
        };
      } catch (e) {
        // If error response body is not valid JSON, use HTTP status text as message.
        console.warn(
          '[Dify Conversation Service] Failed to parse error response JSON.',
          e
        );
      }

      console.error(
        `[Dify Conversation Service] Failed to delete conversation (${response.status}):`,
        errorData
      );
      // Throw error object, upper caller can catch and handle
      throw errorData;
    }

    // On success, parse JSON data
    const data: DeleteConversationResponse =
      response.status === 204 ? { result: 'success' } : await response.json();
    console.log(
      '[Dify Conversation Service] Successfully deleted conversation.',
      data
    );
    return data;
  } catch (error) {
    // Handle network errors from fetch or other uncaught errors in try block
    console.error(
      '[Dify Conversation Service] Network or unexpected error while deleting conversation:',
      error
    );
    // Rethrow error, or wrap as a standardized error object
    // If error is already our errorData structure, just throw it
    if (
      error &&
      typeof error === 'object' &&
      ('status' in error || 'message' in error)
    ) {
      throw error;
    }
    // Otherwise, wrap as a generic error structure
    throw {
      message:
        error instanceof Error ? error.message : 'An unexpected error occurred',
      code: 'NETWORK_ERROR',
    } as DifyApiError;
  }
}

/**
 * Rename a specific conversation or trigger asynchronous title generation.
 *
 * Works by sending a POST request to the backend Dify proxy service at `/conversations/{conversationId}/name`.
 *
 * Dual functionality:
 * 1. **Direct rename**: When `name` is provided in `payload`, renames the conversation to the specified name.
 * 2. **Async title generation**: When `auto_generate: true` is set in `payload` and `name` is not provided,
 *    this endpoint triggers Dify backend to asynchronously generate a title for the conversation.
 *    On success, the returned `RenameConversationResponse` (i.e., the updated conversation object) will have the `name` field containing the generated or existing title.
 *
 * @param appId - The current Dify application's ID.
 * @param conversationId - The ID of the conversation to operate on.
 * @param payload - An object containing the `user` identifier.
 *                  - To directly rename, also include the `name` field.
 *                  - To trigger async title generation, include `auto_generate: true` and do not include `name`.
 * @returns A Promise resolving to a `RenameConversationResponse` object, which contains the updated conversation info (including its `name`/title).
 * @throws If the request fails or the API returns a non-2xx status code, throws an error object (similar to DifyApiError).
 */
export async function renameConversation(
  appId: string,
  conversationId: string,
  payload: RenameConversationRequestPayload
): Promise<RenameConversationResponse> {
  if (!appId) {
    console.warn(
      '[Dify Conversation Service] Warning: appId is not provided. API call may fail or use a default app.'
    );
  }

  if (!conversationId) {
    throw new Error('[Dify Conversation Service] conversationId is required.');
  }

  const slug = `conversations/${conversationId}/name`; // Endpoint path in Dify API for renaming a conversation
  const apiUrl = `${DIFY_PROXY_BASE_URL}/${appId}/${slug}`;

  console.log(
    `[Dify Conversation Service] Renaming conversation: ${conversationId}`
  );

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Try to parse error response body for more detailed error info
      let errorData: DifyApiError | { message: string; code?: string } = {
        message: `API request failed with status ${response.status}: ${response.statusText}`,
      };
      try {
        // Try to parse error response as JSON. Dify error responses are usually JSON.
        const parsedError = await response.json();
        errorData = {
          status: response.status,
          code: parsedError.code || response.status.toString(),
          message: parsedError.message || response.statusText,
          ...parsedError, // Include other possible error fields
        };
      } catch (e) {
        // If error response body is not valid JSON, use HTTP status text as message.
        console.warn(
          '[Dify Conversation Service] Failed to parse error response JSON.',
          e
        );
      }

      console.error(
        `[Dify Conversation Service] Failed to rename conversation (${response.status}):`,
        errorData
      );
      // Throw error object, upper caller can catch and handle
      throw errorData;
    }

    // On success, parse JSON data
    const data: RenameConversationResponse = await response.json();
    console.log(
      '[Dify Conversation Service] Successfully renamed conversation.',
      data
    );
    return data;
  } catch (error) {
    // Handle network errors from fetch or other uncaught errors in try block
    console.error(
      '[Dify Conversation Service] Network or unexpected error while renaming conversation:',
      error
    );
    // Rethrow error, or wrap as a standardized error object
    // If error is already our errorData structure, just throw it
    if (
      error &&
      typeof error === 'object' &&
      ('status' in error || 'message' in error)
    ) {
      throw error;
    }
    // Otherwise, wrap as a generic error structure
    throw {
      message:
        error instanceof Error ? error.message : 'An unexpected error occurred',
      code: 'NETWORK_ERROR',
    } as DifyApiError;
  }
}

/**
 * Fetch variables for a specific conversation.
 *
 * Works by sending a GET request to the backend Dify proxy service.
 * Supports pagination via `last_id` and `limit` parameters.
 *
 * @param appId - The current Dify application's ID.
 * @param conversationId - The ID of the conversation to fetch variables for.
 * @param params - An object containing `user`, and optionally `last_id` and `limit`.
 * @returns A Promise resolving to a `GetConversationVariablesResponse` object, which contains the variable list and pagination info.
 * @throws If the request fails or the API returns a non-2xx status code, throws an error object (similar to DifyApiError).
 */
export async function getConversationVariables(
  appId: string,
  conversationId: string,
  params: GetConversationVariablesParams
): Promise<GetConversationVariablesResponse> {
  if (!appId) {
    console.warn(
      '[Dify Conversation Service] Warning: appId is not provided. API call may fail or use a default app.'
    );
  }

  if (!conversationId) {
    throw new Error('[Dify Conversation Service] conversationId is required.');
  }

  const slug = `conversations/${conversationId}/variables`; // Endpoint path in Dify API for fetching conversation variables
  const apiUrl = `${DIFY_PROXY_BASE_URL}/${appId}/${slug}`;

  // Build query parameter string
  const queryParams = new URLSearchParams();
  queryParams.append('user', params.user);

  if (params.limit !== undefined) {
    queryParams.append('limit', String(params.limit));
  }
  if (params.last_id) {
    queryParams.append('last_id', params.last_id);
  }

  const fullUrl = `${apiUrl}?${queryParams.toString()}`;

  console.log(
    `[Dify Conversation Service] Fetching conversation variables from: ${fullUrl}`
  );

  try {
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json', // Expect JSON response
      },
    });

    if (!response.ok) {
      // Try to parse error response body for more detailed error info
      let errorData: DifyApiError | { message: string; code?: string } = {
        message: `API request failed with status ${response.status}: ${response.statusText}`,
      };
      try {
        // Try to parse error response as JSON. Dify error responses are usually JSON.
        const parsedError = await response.json();
        errorData = {
          status: response.status,
          code: parsedError.code || response.status.toString(),
          message: parsedError.message || response.statusText,
          ...parsedError, // Include other possible error fields
        };
      } catch (e) {
        // If error response body is not valid JSON, use HTTP status text as message.
        console.warn(
          '[Dify Conversation Service] Failed to parse error response JSON.',
          e
        );
      }

      console.error(
        `[Dify Conversation Service] Failed to get conversation variables (${response.status}):`,
        errorData
      );
      // Throw error object, upper caller can catch and handle
      throw errorData;
    }

    // On success, parse JSON data
    const data: GetConversationVariablesResponse = await response.json();
    console.log(
      '[Dify Conversation Service] Successfully fetched conversation variables.',
      data
    );
    return data;
  } catch (error) {
    // Handle network errors from fetch or other uncaught errors in try block
    console.error(
      '[Dify Conversation Service] Network or unexpected error while fetching conversation variables:',
      error
    );
    // Rethrow error, or wrap as a standardized error object
    // If error is already our errorData structure, just throw it
    if (
      error &&
      typeof error === 'object' &&
      ('status' in error || 'message' in error)
    ) {
      throw error;
    }
    // Otherwise, wrap as a generic error structure
    throw {
      message:
        error instanceof Error ? error.message : 'An unexpected error occurred',
      code: 'NETWORK_ERROR',
    } as DifyApiError;
  }
}

// You can add more conversation-related service functions in this file as needed,
// e.g., createConversation, etc.
