import { definitiveTaskError } from '../submission';
import { DifyApiError, DifyWorkflowErrorCode } from '../types';

export function createUnsupportedWorkflowPauseError(): Error {
  const error = new Error(
    'This Dify run is paused for Human Input. Human Input forms and resuming runs are not supported by this client yet; continue in a compatible Dify client.'
  );
  error.name = 'DifyWorkflowPauseUnsupported';
  return error;
}

export function handleWorkflowApiError(
  status: number,
  errorBody: string
): Error {
  const classify = (error: Error) =>
    status >= 400 && status < 500 && ![408, 409].includes(status)
      ? definitiveTaskError(error, 'refused')
      : error;
  try {
    const errorData = JSON.parse(errorBody) as DifyApiError;
    const errorCode = errorData.code as DifyWorkflowErrorCode;

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
    return classify(
      new Error(`Dify Workflow API Error (${status}): ${friendlyMessage}`)
    );
  } catch {
    return classify(
      new Error(`Dify Workflow API request failed (${status}): ${errorBody}`)
    );
  }
}
