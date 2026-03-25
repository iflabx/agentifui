import { DifyStopTaskRequestPayload, DifyStopTaskResponse } from '../types';
import { DIFY_API_BASE_URL } from './constants';
import { throwAppRequestError } from './helpers';

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
    user,
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
      await throwAppRequestError(
        response,
        rawBody => `Failed to stop Dify task ${taskId}. ${rawBody}`,
        () =>
          `Failed to stop Dify task ${taskId}. ${response.status} ${response.statusText}`
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
