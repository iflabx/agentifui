import type {
  DifyApiError,
  GetMessagesParams,
  GetMessagesResponse,
} from './types';

const DIFY_PROXY_BASE_URL = '/api/dify';

export async function getConversationMessages(
  appId: string,
  params: GetMessagesParams
): Promise<GetMessagesResponse> {
  if (!appId) {
    throw new Error('[Dify Message Service] appId is required.');
  }

  if (!params.conversation_id) {
    throw new Error('[Dify Message Service] conversation_id is required.');
  }

  if (!params.user) {
    throw new Error('[Dify Message Service] user is required.');
  }

  const slug = `messages?conversation_id=${encodeURIComponent(
    params.conversation_id
  )}&user=${encodeURIComponent(params.user)}`;
  const searchParams = new URLSearchParams();

  if (params.first_id) {
    searchParams.append('first_id', params.first_id);
  }
  if (params.limit !== undefined) {
    searchParams.append('limit', String(params.limit));
  }

  const queryString = searchParams.toString();
  const apiUrl = `${DIFY_PROXY_BASE_URL}/${appId}/${slug}${queryString ? `&${queryString}` : ''}`;

  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    let errorData: DifyApiError | { message: string; code?: string } = {
      message: `API request failed with status ${response.status}: ${response.statusText}`,
    };

    try {
      const parsedError = await response.json();
      errorData = {
        status: response.status,
        code: parsedError.code || response.status.toString(),
        message: parsedError.message || response.statusText,
        ...parsedError,
      };
    } catch {
      // Fall back to the HTTP status text when Dify does not return JSON.
    }

    throw errorData;
  }

  return response.json();
}
