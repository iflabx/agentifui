import type {
  DifyApiError,
  DifyAppInfoResponse,
  DifyAppParametersResponse,
} from './types';

interface TempApiConfig {
  apiUrl: string;
  apiKey: string;
}

function toDifyProxyUrl(appId: string, slug: string) {
  return `/api/dify/${appId}/${slug}`;
}

async function requestViaProxy<T>(
  appId: string,
  slug: string,
  tempConfig?: TempApiConfig
): Promise<T> {
  const response = await fetch(toDifyProxyUrl(appId, slug), {
    method: tempConfig ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    body: tempConfig
      ? JSON.stringify({
          _temp_config: {
            apiUrl: tempConfig.apiUrl,
            apiKey: tempConfig.apiKey,
          },
        })
      : undefined,
  });

  if (!response.ok) {
    let message = response.statusText || 'Request failed';

    try {
      const errorData = (await response.json()) as Partial<DifyApiError>;
      if (typeof errorData.message === 'string' && errorData.message.trim()) {
        message = errorData.message;
      }
    } catch {
      // keep fallback message
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function getDifyAppParameters(
  appId: string
): Promise<DifyAppParametersResponse> {
  return requestViaProxy<DifyAppParametersResponse>(appId, 'parameters');
}

export async function getDifyAppInfo(
  appId: string
): Promise<DifyAppInfoResponse> {
  return requestViaProxy<DifyAppInfoResponse>(appId, 'info');
}

export async function getDifyAppParametersWithConfig(
  appId: string,
  apiConfig: TempApiConfig
): Promise<DifyAppParametersResponse> {
  if (!apiConfig.apiUrl || !apiConfig.apiKey) {
    throw new Error('API URL and API Key are required');
  }

  return requestViaProxy<DifyAppParametersResponse>(
    appId,
    'parameters',
    apiConfig
  );
}

export async function getDifyAppInfoWithConfig(
  appId: string,
  apiConfig: TempApiConfig
): Promise<DifyAppInfoResponse> {
  if (!apiConfig.apiUrl || !apiConfig.apiKey) {
    throw new Error('API URL and API Key are required');
  }

  return requestViaProxy<DifyAppInfoResponse>(appId, 'info', apiConfig);
}
