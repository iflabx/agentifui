import {
  DifyApiError,
  DifyWorkflowRunDetailResponse,
  GetDifyWorkflowLogsParams,
  GetDifyWorkflowLogsResponse,
} from '../types';

export function buildWorkflowLogsQueryString(
  params?: GetDifyWorkflowLogsParams
): string {
  const searchParams = new URLSearchParams();
  if (params?.keyword) {
    searchParams.append('keyword', params.keyword);
  }
  if (params?.status) {
    searchParams.append('status', params.status);
  }
  if (params?.page) {
    searchParams.append('page', params.page.toString());
  }
  if (params?.limit) {
    searchParams.append('limit', params.limit.toString());
  }
  return searchParams.toString();
}

export async function getDifyWorkflowRunDetail(
  appId: string,
  workflowRunId: string
): Promise<DifyWorkflowRunDetailResponse> {
  const slug = `workflows/run/${workflowRunId}`;
  const apiUrl = `/api/dify/${appId}/${slug}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Workflow run record not found');
      }

      let errorData: DifyApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          status: response.status,
          code: response.status.toString(),
          message: response.statusText || 'Failed to get workflow run detail',
        };
      }

      console.error(
        '[Dify Workflow Service] Failed to get workflow run detail:',
        errorData
      );
      throw new Error(
        `Failed to get workflow run detail: ${errorData.message}`
      );
    }

    const result: DifyWorkflowRunDetailResponse = await response.json();

    console.log(
      '[Dify Workflow Service] Successfully got workflow run detail:',
      {
        appId,
        workflowRunId,
        status: result.status,
        totalSteps: result.total_steps,
        totalTokens: result.total_tokens,
      }
    );

    return result;
  } catch (error) {
    console.error(
      '[Dify Workflow Service] Error occurred while getting workflow run detail:',
      error
    );

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unknown error occurred while getting workflow run detail');
  }
}

export async function getDifyWorkflowLogs(
  appId: string,
  params?: GetDifyWorkflowLogsParams
): Promise<GetDifyWorkflowLogsResponse> {
  const slug = 'workflows/logs';
  const queryString = buildWorkflowLogsQueryString(params);
  const apiUrl = `/api/dify/${appId}/${slug}${queryString ? `?${queryString}` : ''}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      let errorData: DifyApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          status: response.status,
          code: response.status.toString(),
          message: response.statusText || 'Failed to get workflow logs',
        };
      }

      console.error(
        '[Dify Workflow Service] Failed to get workflow logs:',
        errorData
      );
      throw new Error(`Failed to get workflow logs: ${errorData.message}`);
    }

    const result: GetDifyWorkflowLogsResponse = await response.json();

    console.log('[Dify Workflow Service] Successfully got workflow logs:', {
      appId,
      params,
      page: result.page,
      limit: result.limit,
      total: result.total,
      dataCount: result.data.length,
      hasMore: result.has_more,
    });

    return result;
  } catch (error) {
    console.error(
      '[Dify Workflow Service] Error occurred while getting workflow logs:',
      error
    );

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unknown error occurred while getting workflow logs');
  }
}
