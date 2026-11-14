/** @jest-environment node */
import Fastify from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { resolveAgentApp } from '../lib/agent-app';
import { AgentPolicyError } from '../lib/agent-backends';
import { moderateInputText } from '../lib/agent-input-moderation';
import { executeAgentRun } from '../lib/agent-run-execution';
import {
  AgentRunError,
  type AgentRunRecord,
  getRunForActor,
  reserveRun,
  saveRunResult,
} from '../lib/agent-runs-repository';
import { registerSubmission, rejectSubmission } from '../lib/agent-submissions';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { agentRunsRoutes } from './agent-runs';

jest.mock('../lib/agent-app', () => ({
  ...jest.requireActual('../lib/agent-app'),
  resolveAgentApp: jest.fn(),
}));
jest.mock('../lib/agent-input-moderation', () => ({
  moderateInputText: jest.fn(),
}));
jest.mock('../lib/agent-run-execution', () => ({
  ...jest.requireActual('../lib/agent-run-execution'),
  executeAgentRun: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../lib/agent-runs-repository', () => ({
  ...jest.requireActual('../lib/agent-runs-repository'),
  reserveRun: jest.fn(),
  getRunForActor: jest.fn(),
  saveRunResult: jest.fn(),
}));
jest.mock('../lib/agent-submissions', () => ({
  ...jest.requireActual('../lib/agent-submissions'),
  registerSubmission: jest.fn(),
  rejectSubmission: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../lib/session-identity', () => ({
  resolveIdentityFromSession: jest.fn(),
}));
jest.mock('../lib/capacity-control', () => ({
  trackApiBackgroundTask: jest.fn(),
}));

const APP = '10000000-0000-4000-8000-000000000001';
const SUBMISSION = '20000000-0000-4000-8000-000000000001';
const RUN = '30000000-0000-4000-8000-000000000001';
const task = { root_task_id: 'root-task', run_id: null } as never;
const run = {
  id: RUN,
  conversation_id: APP,
  user_message_id: APP,
  execution_status: 'reserved',
  persistence_status: 'pending',
  config_fingerprint: 'fingerprint',
  updated_at: new Date(),
  thread_id: null,
  native_run_id: null,
} as AgentRunRecord;
const payload = { submissionId: SUBMISSION, content: 'synthetic input' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(resolveIdentityFromSession).mockResolvedValue({
    kind: 'ok',
    identity: { userId: 'actor', role: 'user' },
  });
  jest.mocked(resolveAgentApp).mockResolvedValue({
    id: APP,
    instanceId: 'agent',
    name: 'Example',
    assistantId: 'agent',
    baseUrl: 'https://example.invalid',
    fingerprint: 'fingerprint',
    apiKey: 'synthetic',
  });
  jest.mocked(registerSubmission).mockResolvedValue({ task, replayed: false });
  jest.mocked(moderateInputText).mockResolvedValue({ outcome: 'skip' });
  jest.mocked(reserveRun).mockResolvedValue({ run, replayed: false });
});

async function request(method: 'POST' | 'GET' = 'POST', language?: string) {
  const server = Fastify({ logger: false });
  await server.register(agentRunsRoutes, {
    config: { corsAllowedOrigins: [] } as unknown as ApiRuntimeConfig,
  });
  try {
    return await server.inject({
      method,
      ...(language ? { headers: { 'accept-language': language } } : {}),
      url: `/api/internal/apps/${APP}/agent/runs${method === 'GET' ? `/${RUN}` : ''}`,
      ...(method === 'POST' ? { payload } : {}),
    });
  } finally {
    await server.close();
  }
}

it('requires server session identity before registering, auditing or executing', async () => {
  jest
    .mocked(resolveIdentityFromSession)
    .mockResolvedValue({ kind: 'unauthorized' });
  expect((await request()).statusCode).toBe(401);
  expect(registerSubmission).not.toHaveBeenCalled();
  expect(executeAgentRun).not.toHaveBeenCalled();
});

it.each(['block', 'unavailable'] as const)(
  'records moderation %s without reserving or executing',
  async outcome => {
    jest
      .mocked(moderateInputText)
      .mockResolvedValue(
        outcome === 'block'
          ? { outcome, categories: ['synthetic'] }
          : { outcome, reason: 'synthetic outage' }
      );
    const response = await request();
    expect(response.statusCode).toBe(outcome === 'block' ? 400 : 503);
    expect(response.json().app_error).toMatchObject({
      code:
        outcome === 'block'
          ? 'CONTENT_MODERATION_BLOCKED'
          : 'CONTENT_MODERATION_UNAVAILABLE',
      retryable: true,
      userMessage: expect.stringMatching(
        outcome === 'block' ? /moderation/i : /temporarily unavailable/i
      ),
    });
    expect(rejectSubmission).toHaveBeenCalled();
    expect(reserveRun).not.toHaveBeenCalled();
    expect(executeAgentRun).not.toHaveBeenCalled();
  }
);

it.each([
  ['AGENT_QUOTA_EXCEEDED', false, /usage allowance/i],
  ['AGENT_CONCURRENCY_LIMIT', true, /another task/i],
] as const)(
  'returns distinct policy semantics for %s',
  async (code, retryable, message) => {
    jest
      .mocked(reserveRun)
      .mockRejectedValueOnce(new AgentPolicyError(429, code));
    const response = await request();
    expect(response.statusCode).toBe(429);
    expect(response.json().app_error).toMatchObject({
      code,
      retryable,
      userMessage: expect.stringMatching(message),
    });
    expect(executeAgentRun).not.toHaveBeenCalled();
  }
);

it('localizes policy errors with the same locale rule as the Dify proxy', async () => {
  jest
    .mocked(reserveRun)
    .mockRejectedValueOnce(new AgentPolicyError(429, 'AGENT_QUOTA_EXCEEDED'));
  const response = await request('POST', 'zh-CN,en;q=0.8');
  expect(response.json().app_error).toMatchObject({
    code: 'AGENT_QUOTA_EXCEEDED',
    retryable: false,
    userMessage:
      '\u5f53\u524d\u5e94\u7528\u7684\u4f7f\u7528\u6b21\u6570\u989d\u5ea6\u5df2\u7528\u5c3d\u3002',
  });
});

it('reserves against the registered root and dispatches just once', async () => {
  const response = await request();
  expect(response.statusCode).toBe(200);
  expect(response.headers['x-agentifui-root-task-id']).toBe('root-task');
  expect(reserveRun).toHaveBeenCalledWith(
    expect.objectContaining({
      governanceTaskId: 'root-task',
      submissionId: SUBMISSION,
    })
  );
  expect(executeAgentRun).toHaveBeenCalledWith(
    expect.objectContaining({
      rootTaskId: 'root-task',
      content: payload.content,
    })
  );
  expect(executeAgentRun).toHaveBeenCalledTimes(1);
});

it('returns stored run status for a replay, never a second moderation or dispatch', async () => {
  jest.mocked(registerSubmission).mockResolvedValue({
    task: { root_task_id: 'root-task', run_id: RUN } as never,
    replayed: true,
  });
  jest.mocked(reserveRun).mockResolvedValue({ run, replayed: true });
  expect((await request()).statusCode).toBe(200);
  expect(moderateInputText).not.toHaveBeenCalled();
  expect(executeAgentRun).not.toHaveBeenCalled();
});

it('rejects quota, unknown replay and changed-input collision before native execution', async () => {
  jest
    .mocked(reserveRun)
    .mockRejectedValueOnce(new AgentPolicyError(429, 'AGENT_QUOTA_EXCEEDED'));
  expect((await request()).statusCode).toBe(429);
  expect(rejectSubmission).toHaveBeenCalledWith(
    'root-task',
    'AGENT_QUOTA_EXCEEDED'
  );
  jest
    .mocked(registerSubmission)
    .mockResolvedValueOnce({ task, replayed: true });
  expect((await request()).statusCode).toBe(409);
  jest
    .mocked(registerSubmission)
    .mockRejectedValueOnce(
      new AgentPolicyError(409, 'AGENT_SUBMISSION_MISMATCH')
    );
  expect((await request()).statusCode).toBe(409);
  expect(executeAgentRun).not.toHaveBeenCalled();
});

it('save-only status retry never registers, moderates, reserves or redispatches', async () => {
  const result = { executionStatus: 'success' as const, messages: [] };
  jest.mocked(getRunForActor).mockResolvedValue({
    ...run,
    result,
    execution_status: 'success',
    persistence_status: 'failed',
  });
  jest.mocked(saveRunResult).mockResolvedValue({
    ...run,
    result,
    execution_status: 'success',
    persistence_status: 'saved',
  });
  expect((await request('GET')).statusCode).toBe(200);
  expect(saveRunResult).toHaveBeenCalledWith(RUN, result);
  expect(registerSubmission).not.toHaveBeenCalled();
  expect(moderateInputText).not.toHaveBeenCalled();
  expect(reserveRun).not.toHaveBeenCalled();
  expect(executeAgentRun).not.toHaveBeenCalled();
});

it('returns only authorized visible snapshot fields while a known save continues failing', async () => {
  jest.mocked(getRunForActor).mockResolvedValue({
    ...run,
    execution_status: 'success',
    persistence_status: 'failed',
    result: {
      executionStatus: 'success',
      messages: [{ id: 'answer', content: 'Known answer', order: 0 }],
    },
  });
  jest
    .mocked(saveRunResult)
    .mockRejectedValue(new AgentRunError(503, 'AGENT_STORAGE_UNAVAILABLE'));
  const response = await request('GET');
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    executionStatus: 'success',
    persistenceStatus: 'failed',
    errorCode: 'AGENT_SAVE_FAILED',
    recoveryMessages: [
      {
        id: 'answer',
        role: 'assistant',
        content: 'Known answer',
        metadata: { backend_run_id: RUN, projection_order: 0 },
      },
    ],
  });
  expect(response.json()).not.toHaveProperty('result');
  expect(response.json()).not.toHaveProperty('config_fingerprint');
  expect(executeAgentRun).not.toHaveBeenCalled();
  expect(registerSubmission).not.toHaveBeenCalled();
});
