/** @jest-environment node */
import type {
  DifyWorkflowRunDetailResponse,
  GetDifyWorkflowLogsResponse,
} from '../types';
import { getDifyWorkflowLogs, getDifyWorkflowRunDetail } from './query';

describe('Dify Service API workflow query contracts', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps JSON-valued inputs and nullable detail metrics', async () => {
    const detail: DifyWorkflowRunDetailResponse = {
      id: 'run-1',
      workflow_id: 'workflow-1',
      status: 'paused',
      inputs: { question: 'test', count: 0, enabled: false },
      outputs: {},
      error: null,
      total_steps: null,
      total_tokens: null,
      created_at: null,
      finished_at: null,
      elapsed_time: null,
    };
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => detail } as Response);
    await expect(getDifyWorkflowRunDetail('app-1', 'run-1')).resolves.toEqual(
      detail
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dify/app-1/workflows/run/run-1',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('preserves the nested workflow_run log envelope instead of inventing flat outputs', async () => {
    const logs: GetDifyWorkflowLogsResponse = {
      page: 1,
      limit: 20,
      total: 2,
      has_more: false,
      data: [
        {
          id: 'log-1',
          workflow_run: {
            id: 'run-1',
            status: 'partial-succeeded',
            version: 'published',
            total_steps: 2,
            finished_at: 3,
            exceptions_count: 1,
          },
          created_at: 1,
          created_from: 'service-api',
        },
        { id: 'log-2', workflow_run: null, created_at: null },
      ],
    };
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => logs } as Response);
    await expect(
      getDifyWorkflowLogs('app-1', { status: 'failed' })
    ).resolves.toEqual(logs);
  });
});
