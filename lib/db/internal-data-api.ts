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
    const response = await fetch('/api/internal/data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ action, payload }),
    });

    const json = (await response.json()) as InternalDataApiResponse<T>;

    if (!response.ok || !json.success) {
      const message =
        json && 'error' in json && json.error
          ? json.error
          : `Internal data action failed: ${action}`;
      return failure(new Error(message));
    }

    return success(json.data);
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}
