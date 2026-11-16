/** @jest-environment node */
import Fastify from 'fastify';
import { createHash } from 'node:crypto';

import type { ApiRuntimeConfig } from '../config';
import { resolveAgentApp } from '../lib/agent-app';
import { parseAgentDeliverables } from '../lib/agent-result';
import {
  getRunForActor,
  recordRunDeliverables,
} from '../lib/agent-runs-repository';
import {
  LangChainUpstreamError,
  getCapabilities,
  getPhase4Artifact,
  getPhase4Result,
} from '../lib/langchain/transport';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { agentRunsRoutes } from './agent-runs';

jest.mock('../lib/agent-app', () => ({
  ...jest.requireActual('../lib/agent-app'),
  resolveAgentApp: jest.fn(),
}));
jest.mock('../lib/agent-runs-repository', () => ({
  ...jest.requireActual('../lib/agent-runs-repository'),
  getRunForActor: jest.fn(),
  recordRunDeliverables: jest.fn(),
}));
jest.mock('../lib/langchain/transport', () => ({
  ...jest.requireActual('../lib/langchain/transport'),
  getCapabilities: jest.fn(),
  getPhase4Artifact: jest.fn(),
  getPhase4Result: jest.fn(),
}));
jest.mock('../lib/session-identity', () => ({
  resolveIdentityFromSession: jest.fn(),
}));
jest.mock('../lib/pg-context', () => ({
  ...jest.requireActual('../lib/pg-context'),
  queryRowsWithPgSystemContext: jest.fn(),
}));

const APP = '10000000-0000-4000-8000-000000000001';
const RUN = '20000000-0000-4000-8000-000000000001';
const CONTENT = Buffer.from('# Synthetic report\n');
const manifest = parseAgentDeliverables({
  profile: 'phase4.result.v1',
  thread_id: 'thread-1',
  run_id: 'native-1',
  execution_status: 'success',
  result_status: 'ready',
  reason: null,
  artifacts: [
    {
      artifact_id: 'report',
      filename: 'report.md',
      media_type: 'text/markdown',
      size_bytes: CONTENT.length,
      sha256: createHash('sha256').update(CONTENT).digest('hex'),
    },
  ],
  sources: [],
});

describe('authorized agent results', () => {
  let run: NonNullable<Awaited<ReturnType<typeof getRunForActor>>>;
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(resolveIdentityFromSession).mockResolvedValue({
      kind: 'ok',
      identity: { userId: APP, authUserId: APP, role: 'user' },
    });
    jest.mocked(resolveAgentApp).mockResolvedValue({
      id: APP,
      instanceId: 'synthetic',
      name: 'Synthetic',
      backendType: 'langchain',
      assistantId: 'deep-agent',
      baseUrl: 'https://example.invalid',
      apiKey: 'synthetic',
      fingerprint: 'fingerprint',
      resultProfileEnabled: false,
    });
    run = {
      id: RUN,
      conversation_id: APP,
      config_fingerprint: 'fingerprint',
      thread_id: 'thread-1',
      native_run_id: 'native-1',
      execution_status: 'unknown',
      persistence_status: 'pending',
      deliverables: null,
    } as typeof run;
    jest.mocked(getRunForActor).mockImplementation(async () => run);
    jest.mocked(getCapabilities).mockResolvedValue({
      assistantId: 'deep-agent',
      aguiPath: '/ag-ui/deep',
      resultProfile: 'phase4.result.v1',
      resultFormats: ['text/markdown', 'text/csv'],
    });
    jest.mocked(getPhase4Result).mockResolvedValue(manifest);
    jest.mocked(recordRunDeliverables).mockImplementation(async () => {
      run.deliverables = manifest;
      return run;
    });
    jest
      .mocked(getPhase4Artifact)
      .mockResolvedValue({ bytes: CONTENT, contentType: 'text/markdown' });
  });

  async function request(suffix = 'deliverables') {
    const server = Fastify({ logger: false });
    await server.register(agentRunsRoutes, {
      config: { corsAllowedOrigins: [] } as unknown as ApiRuntimeConfig,
    });
    try {
      return await server.inject({
        method: 'GET',
        url: `/api/internal/apps/${APP}/agent/runs/${RUN}/${suffix}`,
      });
    } finally {
      await server.close();
    }
  }

  it('finds ready results with paused admission while keeping unknown execution unchanged', async () => {
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.json().deliverables).toMatchObject({
      schemaVersion: 1,
      resultStatus: 'ready',
    });
    expect(response.json().deliverables).not.toHaveProperty('threadId');
    expect(response.json().deliverables).not.toHaveProperty('runId');
    expect(run.execution_status).toBe('unknown');
    expect(run.persistence_status).toBe('pending');
    expect(recordRunDeliverables).toHaveBeenCalledWith(RUN, manifest);
  });

  it('reads stored canonical metadata without requiring an online upstream', async () => {
    run.deliverables = manifest;
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.json().deliverables.artifacts[0].artifactId).toBe('report');
    expect(getCapabilities).not.toHaveBeenCalled();
    expect(getPhase4Result).not.toHaveBeenCalled();
  });

  it('discovers and reads results for a compatible assistant with a different name', async () => {
    const configured = await resolveAgentApp(APP, APP);
    jest
      .mocked(resolveAgentApp)
      .mockResolvedValue({ ...configured, assistantId: 'reports-agent' });
    jest.mocked(getCapabilities).mockResolvedValue({
      assistantId: 'reports-agent',
      aguiPath: '/ag-ui/deep',
      resultProfile: 'phase4.result.v1',
      resultFormats: ['text/markdown', 'text/csv'],
    });
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.json().deliverables).not.toHaveProperty('profile');
    expect((await request('artifacts/report')).statusCode).toBe(200);
  });

  it('keeps registered results readable after the optional profile setting is removed', async () => {
    const configured = await resolveAgentApp(APP, APP);
    jest
      .mocked(resolveAgentApp)
      .mockResolvedValue({ ...configured, resultProfileEnabled: undefined });
    run.deliverables = manifest;
    expect((await request()).statusCode).toBe(200);
    expect(getCapabilities).not.toHaveBeenCalled();
  });

  it('rejects new work for a paused profile independently of the assistant name', async () => {
    const configured = await resolveAgentApp(APP, APP);
    jest
      .mocked(resolveAgentApp)
      .mockResolvedValue({ ...configured, assistantId: 'reports-agent' });
    const server = Fastify({ logger: false });
    await server.register(agentRunsRoutes, {
      config: {
        corsAllowedOrigins: ['http://localhost'],
      } as unknown as ApiRuntimeConfig,
    });
    try {
      const response = await server.inject({
        method: 'POST',
        url: `/api/internal/apps/${APP}/agent/runs`,
        headers: { origin: 'http://localhost' },
        payload: { submissionId: RUN, content: 'Generate a report' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.body).toContain('AGENT_RESULT_PROFILE_DISABLED');
      expect(getCapabilities).not.toHaveBeenCalled();
      expect(getPhase4Result).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it.each(['', '?before=10&limit=1'])(
    'keeps unregistered unknown results discoverable in history %s',
    async query => {
      jest
        .mocked(queryRowsWithPgSystemContext)
        .mockResolvedValueOnce([{ id: APP, legacy_tools: false }])
        .mockResolvedValueOnce([
          { id: APP, sequence_index: 8, metadata: { backend_run_id: RUN } },
        ])
        .mockResolvedValueOnce([run]);
      const server = Fastify({ logger: false });
      await server.register(agentRunsRoutes, {
        config: { corsAllowedOrigins: [] } as unknown as ApiRuntimeConfig,
      });
      try {
        const response = await server.inject({
          method: 'GET',
          url: `/api/internal/apps/${APP}/agent/conversations/${APP}${query}`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().runs[0]).toMatchObject({
          executionStatus: 'unknown',
          deliverablesQueryAvailable: true,
        });
        expect(
          jest.mocked(queryRowsWithPgSystemContext).mock.calls[2][0]
        ).toMatch(/SELECT[^;]*native_run_id/);
        expect(getPhase4Result).not.toHaveBeenCalled();
      } finally {
        await server.close();
      }
    }
  );

  it('authenticates and verifies ownership before reading upstream bytes', async () => {
    jest
      .mocked(resolveIdentityFromSession)
      .mockResolvedValueOnce({ kind: 'unauthorized' });
    expect((await request('artifacts/report')).statusCode).toBe(401);
    jest.mocked(getRunForActor).mockResolvedValueOnce(null);
    expect((await request('artifacts/report')).statusCode).toBe(404);
    expect(getPhase4Artifact).not.toHaveBeenCalled();
  });

  it('rejects configuration changes before querying the result', async () => {
    run.config_fingerprint = 'changed';
    expect((await request()).statusCode).toBe(409);
    expect(getPhase4Result).not.toHaveBeenCalled();
  });

  it('returns verified bytes with safe response headers', async () => {
    run.deliverables = manifest;
    const response = await request('artifacts/report');
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(CONTENT);
    expect(response.headers).toMatchObject({
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'attachment; filename="report.md"',
    });
  });

  it.each([
    { bytes: Buffer.from('changed'), contentType: 'text/markdown' },
    { bytes: CONTENT, contentType: 'text/csv' },
  ])('does not return bytes failing manifest integrity %#', async value => {
    run.deliverables = manifest;
    jest.mocked(getPhase4Artifact).mockResolvedValue(value);
    const response = await request('artifacts/report');
    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('AGENT_RESULT_INTEGRITY_FAILED');
  });

  it('denies bytes when the conversation is deleted during the upstream read', async () => {
    run.deliverables = manifest;
    jest.mocked(getPhase4Artifact).mockImplementation(async () => {
      jest.mocked(getRunForActor).mockResolvedValue(null);
      return { bytes: CONTENT, contentType: 'text/markdown' };
    });
    expect((await request('artifacts/report')).statusCode).toBe(404);
  });

  it.each([
    [404, 404, 'NOT_FOUND'],
    [409, 409, 'PENDING'],
    [422, 422, 'UNAVAILABLE'],
    [503, 503, 'UPSTREAM_UNAVAILABLE'],
  ])('maps upstream %i distinctly', async (status, expected, code) => {
    jest
      .mocked(getPhase4Result)
      .mockRejectedValue(
        new LangChainUpstreamError('UPSTREAM_HTTP_ERROR', Number(status))
      );
    const response = await request();
    expect(response.statusCode).toBe(expected);
    expect(response.body).toContain(`AGENT_RESULT_${code}`);
  });
});
