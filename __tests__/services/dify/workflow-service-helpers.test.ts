/** @jest-environment node */
import { handleWorkflowApiError } from '@lib/services/dify/workflow-service/errors';
import { buildWorkflowLogsQueryString } from '@lib/services/dify/workflow-service/query';

describe('workflow service helpers', () => {
  it('maps known workflow error codes to friendly messages', () => {
    const error = handleWorkflowApiError(
      400,
      JSON.stringify({
        code: 'provider_quota_exceeded',
        message: 'quota',
      })
    );

    expect(error.message).toContain('Model provider quota exceeded');
    expect(error.message).toContain('(400)');
  });

  it('falls back to raw body when workflow error body is not json', () => {
    const error = handleWorkflowApiError(500, 'plain-text-error');

    expect(error.message).toBe(
      'Dify Workflow API request failed (500): plain-text-error'
    );
  });

  it('builds workflow logs query string from params', () => {
    const result = buildWorkflowLogsQueryString({
      keyword: 'test',
      status: 'succeeded',
      page: 2,
      limit: 10,
    });

    expect(result).toContain('keyword=test');
    expect(result).toContain('status=succeeded');
    expect(result).toContain('page=2');
    expect(result).toContain('limit=10');
  });
});
