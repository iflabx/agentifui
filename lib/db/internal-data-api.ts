import { Result, failure, success } from '@lib/types/result';

interface InternalDataApiSuccess<T> {
  success: true;
  data: T;
}

interface InternalDataApiFailure {
  success: false;
  error: string;
}

type InternalDataApiResponse<T> =
  | InternalDataApiSuccess<T>
  | InternalDataApiFailure;

const FASTIFY_BYPASS_HEADER = 'x-agentifui-fastify-bypass';

interface InternalDataApiRequestResult<T> {
  response: Response | null;
  json: InternalDataApiResponse<T> | null;
  networkError: Error | null;
}

function toErrorMessage<T>(
  action: string,
  response: Response | null,
  json: InternalDataApiResponse<T> | null,
  networkError: Error | null
): string {
  if (networkError) {
    return networkError.message;
  }

  if (json && 'error' in json && json.error) {
    return json.error;
  }

  if (response) {
    return `Internal data action failed (${response.status})`;
  }

  return `Internal data action failed: ${action}`;
}

async function requestInternalData<T>(
  action: string,
  payload: unknown,
  useRewriteBypass: boolean
): Promise<InternalDataApiRequestResult<T>> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (useRewriteBypass) {
      headers[FASTIFY_BYPASS_HEADER] = '1';
    }

    const response = await fetch('/api/internal/data', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ action, payload }),
    });
    const json = (await response
      .json()
      .catch(() => null)) as InternalDataApiResponse<T> | null;

    return {
      response,
      json,
      networkError: null,
    };
  } catch (error) {
    return {
      response: null,
      json: null,
      networkError:
        error instanceof Error
          ? error
          : new Error(String(error ?? 'Unknown error')),
    };
  }
}

function shouldRetryViaLegacy<T>(
  firstAttempt: InternalDataApiRequestResult<T>
): boolean {
  if (firstAttempt.networkError) {
    return true;
  }

  if (!firstAttempt.response) {
    return true;
  }

  return firstAttempt.response.status >= 500;
}

/**
 * Browser-side bridge for calling internal data actions.
 * Server-side callers should not use this helper.
 */
export async function callInternalDataAction<T>(
  action: string,
  payload?: unknown
): Promise<Result<T>> {
  if (typeof window === 'undefined') {
    return failure(
      new Error(
        `callInternalDataAction("${action}") can only run in browser runtime`
      )
    );
  }

  try {
    const firstAttempt = await requestInternalData<T>(action, payload, false);
    const finalAttempt = shouldRetryViaLegacy(firstAttempt)
      ? await requestInternalData<T>(action, payload, true)
      : firstAttempt;

    const { response, json, networkError } = finalAttempt;

    if (networkError) {
      return failure(networkError);
    }

    if (!response || !json || !response.ok || !json.success) {
      return failure(
        new Error(toErrorMessage(action, response, json, networkError))
      );
    }

    return success(json.data);
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}
