/** @jest-environment node */
import { streamDifyChat } from './chat-service/stream';
import {
  executeDifyCompletion,
  streamDifyCompletion,
} from './completion-service';
import {
  executeDifyWorkflow,
  streamDifyWorkflow,
} from './workflow-service/execution';

describe('Dify generation submission identity', () => {
  const id = '10000000-0000-4000-8000-000000000001';
  const payload = {
    inputs: {},
    query: 'synthetic input',
    user: 'synthetic-user',
    response_mode: 'streaming' as const,
  };
  const callers = [
    (submissionId?: string) =>
      streamDifyChat(payload, 'app', undefined, undefined, { submissionId }),
    (submissionId?: string) =>
      executeDifyCompletion('app', payload, { submissionId }),
    (submissionId?: string) =>
      streamDifyCompletion('app', payload, { submissionId }),
    (submissionId?: string) =>
      executeDifyWorkflow(payload, 'app', { submissionId }),
    (submissionId?: string) =>
      streamDifyWorkflow(payload, 'app', undefined, { submissionId }),
  ];

  beforeEach(() => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('synthetic network interruption'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(callers)(
    'keeps explicit replay identity, generates new identity per question and never retries generation automatically',
    async call => {
      for (const submissionId of [id, id, undefined, undefined])
        await call(submissionId).catch(() => undefined);
      const requests = jest.mocked(fetch).mock.calls.map(([, init]) => init!);
      expect(requests).toHaveLength(4);
      const ids = requests.map(
        init =>
          (init.headers as Record<string, string>)['x-agentifui-submission-id']
      );
      expect(ids.slice(0, 2)).toEqual([id, id]);
      expect(ids[2]).toMatch(/^[a-f\d-]{36}$/);
      expect(ids[3]).not.toBe(ids[2]);
      expect(JSON.parse(requests[0].body as string)).not.toHaveProperty(
        'submissionId'
      );
      expect(JSON.parse(requests[0].body as string).user).toBe(payload.user);
    }
  );
});
