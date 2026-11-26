/** @jest-environment node */
import Fastify from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { AgentAppError, resolveAgentApp } from '../lib/agent-app';
import { AgentPolicyError } from '../lib/agent-backends';
import { executeHumanInputRun } from '../lib/agent-human-input-execution';
import { moderateInputText } from '../lib/agent-input-moderation';
import {
  type AgentInteractionRecord,
  getInteractionForActor,
  getInteractionResponseReplay,
  reserveInteractionResponse,
} from '../lib/agent-interactions-repository';
import { executeAgentRun } from '../lib/agent-run-execution';
import {
  AgentRunError,
  type AgentRunRecord,
  getRunForActor,
  reserveRun,
  saveRunResult,
} from '../lib/agent-runs-repository';
import { registerSubmission, rejectSubmission } from '../lib/agent-submissions';
import { executeDifyAgentRun } from '../lib/agui/dify-execution';
import {
  resolveDifyChatbotInputs,
  uploadDifyChatbotFile,
} from '../lib/agui/dify-transport';
import { normalizeDifyInputCapabilities } from '../lib/dify-input-capabilities';
import { readDifyUpload, saveDifyUpload } from '../lib/dify-upload-archive';
import { getHumanInputState } from '../lib/langchain/human-input';
import {
  readLangChainInputFileMetadata,
  resolveLangChainInputCapabilities,
} from '../lib/langchain/input-files';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { agentRunsRoutes } from './agent-runs';
import { loadTrustedUserProfile } from './dify-proxy-route/trusted-user-context';

jest.mock('../lib/agent-app', () => ({
  ...jest.requireActual('../lib/agent-app'),
  resolveAgentApp: jest.fn(),
}));
jest.mock('../lib/agent-input-moderation', () => ({
  moderateInputText: jest.fn(),
}));
jest.mock('../lib/agent-human-input-execution', () => ({
  ...jest.requireActual('../lib/agent-human-input-execution'),
  executeHumanInputRun: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../lib/agent-interactions-repository', () => ({
  ...jest.requireActual('../lib/agent-interactions-repository'),
  getInteractionForActor: jest.fn(),
  getInteractionResponseReplay: jest.fn(),
  reserveInteractionResponse: jest.fn(),
  expireInteraction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../lib/langchain/human-input', () => ({
  ...jest.requireActual('../lib/langchain/human-input'),
  getHumanInputState: jest.fn(),
}));
jest.mock('../lib/agui/dify-execution', () => ({
  executeDifyAgentRun: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../lib/agui/dify-transport', () => ({
  ...jest.requireActual('../lib/agui/dify-transport'),
  resolveDifyChatbotInputs: jest.fn(),
  uploadDifyChatbotFile: jest.fn(),
}));
jest.mock('../lib/dify-upload-archive', () => ({
  assertDifyUploadStorage: jest.fn(),
  readDifyUpload: jest.fn(),
  saveDifyUpload: jest.fn(),
}));
jest.mock('../lib/langchain/input-files', () => ({
  readLangChainInputFileMetadata: jest.fn(),
  resolveLangChainInputCapabilities: jest.fn(),
}));
jest.mock('../lib/pg-context', () => ({
  ...jest.requireActual('../lib/pg-context'),
  queryRowsWithPgSystemContext: jest.fn(),
}));
jest.mock('./dify-proxy-route/trusted-user-context', () => ({
  ...jest.requireActual('./dify-proxy-route/trusted-user-context'),
  loadTrustedUserProfile: jest.fn().mockResolvedValue(null),
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
const FILE = '40000000-0000-4000-8000-000000000001';
const fileRow = {
  id: FILE,
  slotKey: 'reference',
  nativeId: 'native-file-id',
  name: 'source.txt',
  size: 8,
  type: 'text/plain',
};
const globalDifySlot = {
  enabled: true,
  number_limits: 2,
  allowed_file_types: ['document'],
  allowed_file_upload_methods: ['local_file'],
};
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

describe('human response moderation during a released claim', () => {
  const claimed = {
    id: APP,
    origin_run_id: RUN,
    status: 'submitting',
    expires_at: null,
    submission_id: '40000000-0000-4000-8000-000000000001',
    resume_run_id: RUN,
    prompt: {
      title: 'Confirmation',
      description: 'Synthetic operation',
      actions: ['approve', 'reject'],
      commentMaxLength: 500,
      expiresAt: null,
    },
  } as AgentInteractionRecord;
  let durable: AgentInteractionRecord;
  beforeEach(async () => {
    const app = await resolveAgentApp(APP, 'actor');
    jest.mocked(resolveAgentApp).mockResolvedValue({
      ...app,
      backendType: 'langchain',
      humanInput: true,
    });
    durable = { ...claimed };
    jest
      .mocked(getInteractionForActor)
      .mockReset()
      .mockResolvedValue({ ...claimed });
    jest
      .mocked(getInteractionResponseReplay)
      .mockReset()
      .mockImplementation(async () => {
        durable = {
          ...claimed,
          status: 'pending',
          submission_id: null,
          resume_run_id: null,
        };
        return null;
      });
    jest
      .mocked(reserveInteractionResponse)
      .mockReset()
      .mockImplementation(async () => {
        expect(durable.status).toBe('pending');
        expect(durable.submission_id).toBeNull();
        return { run, replayed: false, interaction: durable };
      });
    jest.mocked(executeHumanInputRun).mockClear();
    jest.mocked(getHumanInputState).mockClear();
  });

  async function respond(comment?: string) {
    const server = Fastify({ logger: false });
    await server.register(agentRunsRoutes, {
      config: { corsAllowedOrigins: [] } as unknown as ApiRuntimeConfig,
    });
    try {
      return await server.inject({
        method: 'POST',
        url: `/api/internal/apps/${APP}/agent/interactions/${APP}/respond`,
        payload: {
          submissionId: SUBMISSION,
          action: 'approve',
          ...(comment === undefined ? {} : { comment }),
        },
      });
    } finally {
      await server.close();
    }
  }

  it.each([
    ['block', 400, 'CONTENT_MODERATION_BLOCKED'],
    ['unavailable', 503, 'CONTENT_MODERATION_UNAVAILABLE'],
  ] as const)(
    'does not claim or execute a new comment when moderation is %s',
    async (outcome, status, code) => {
      jest
        .mocked(moderateInputText)
        .mockResolvedValue(
          outcome === 'block'
            ? { outcome, categories: ['synthetic'] }
            : { outcome, reason: 'Synthetic outage' }
        );
      const response = await respond(
        'New comment after the old preparation failed'
      );
      expect(response.statusCode).toBe(status);
      expect(response.json().app_error.code).toBe(code);
      expect(moderateInputText).toHaveBeenCalledTimes(1);
      expect(moderateInputText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'New comment after the old preparation failed',
        })
      );
      expect(reserveInteractionResponse).not.toHaveBeenCalled();
      expect(executeHumanInputRun).not.toHaveBeenCalled();
      expect(durable.status).toBe('pending');
    }
  );

  it('moderates a new allowed comment before reserving and executing it once', async () => {
    jest
      .mocked(moderateInputText)
      .mockResolvedValue({ outcome: 'allow', categories: [] });
    const response = await respond('Allowed comment');
    expect(response.statusCode).toBe(202);
    expect(response.json().replayed).toBe(false);
    expect(moderateInputText).toHaveBeenCalledTimes(1);
    expect(reserveInteractionResponse).toHaveBeenCalledTimes(1);
    expect(executeHumanInputRun).toHaveBeenCalledTimes(1);
    expect(
      jest.mocked(moderateInputText).mock.invocationCallOrder[0]
    ).toBeLessThan(
      jest.mocked(reserveInteractionResponse).mock.invocationCallOrder[0]
    );
  });

  it.each(['submitting', 'pending'] as const)(
    'returns a confirmed replay without re-auditing or dispatching (%s)',
    async status => {
      jest.mocked(getInteractionForActor).mockResolvedValue({
        ...claimed,
        status,
        submission_id: status === 'pending' ? null : SUBMISSION,
      });
      jest.mocked(getInteractionResponseReplay).mockResolvedValue(run);
      jest
        .mocked(moderateInputText)
        .mockResolvedValue({ outcome: 'block', categories: ['synthetic'] });
      const response = await respond('Previously accepted comment');
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        replayed: true,
        run: { id: RUN },
      });
      expect(moderateInputText).not.toHaveBeenCalled();
      expect(reserveInteractionResponse).not.toHaveBeenCalled();
      expect(getHumanInputState).not.toHaveBeenCalled();
      expect(executeHumanInputRun).not.toHaveBeenCalled();
    }
  );

  it('does not audit an empty new comment', async () => {
    expect((await respond()).statusCode).toBe(202);
    expect(moderateInputText).not.toHaveBeenCalled();
    expect(reserveInteractionResponse).toHaveBeenCalledTimes(1);
    expect(executeHumanInputRun).toHaveBeenCalledTimes(1);
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(resolveLangChainInputCapabilities)
    .mockResolvedValue(normalizeDifyInputCapabilities({}));
  jest
    .mocked(resolveDifyChatbotInputs)
    .mockResolvedValue(normalizeDifyInputCapabilities({}));
  jest.mocked(queryRowsWithPgSystemContext).mockResolvedValue([]);
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

it('returns the configured public introduction through authorized app metadata, not runtime credentials', async () => {
  const app = await resolveAgentApp(APP, 'actor');
  jest
    .mocked(resolveAgentApp)
    .mockResolvedValue({ ...app, description: 'Configured description' });
  const server = Fastify({ logger: false });
  await server.register(agentRunsRoutes, {
    config: { corsAllowedOrigins: [] } as unknown as ApiRuntimeConfig,
  });
  try {
    const response = await server.inject({
      method: 'GET',
      url: `/api/internal/apps/${APP}/agent`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().app).toEqual({
      id: APP,
      name: 'Example',
      description: 'Configured description',
      backendType: 'langchain',
    });
    expect(response.body).not.toContain(app.apiKey);
    expect(response.body).not.toContain(app.baseUrl);
  } finally {
    await server.close();
  }
});

async function request(
  method: 'POST' | 'GET' = 'POST',
  language?: string,
  protocol?: string,
  extra?: Record<string, unknown>
) {
  const server = Fastify({ logger: false });
  await server.register(agentRunsRoutes, {
    config: { corsAllowedOrigins: [] } as unknown as ApiRuntimeConfig,
  });
  try {
    return await server.inject({
      method,
      headers: {
        ...(language ? { 'accept-language': language } : {}),
        ...(protocol ? { 'x-agentifui-protocol': protocol } : {}),
      },
      url: `/api/internal/apps/${APP}/agent/runs${method === 'GET' ? `/${RUN}` : ''}`,
      ...(method === 'POST' ? { payload: { ...payload, ...extra } } : {}),
    });
  } finally {
    await server.close();
  }
}

it('negotiates standard output explicitly without a legacy accepted prelude', async () => {
  const response = await request('POST', undefined, 'ag-ui/1.0');
  expect(response.statusCode).toBe(200);
  expect(response.headers['x-agentifui-protocol']).toBe('ag-ui/1.0');
  expect(response.body).not.toContain('accepted');
  expect(executeAgentRun).toHaveBeenCalledWith(
    expect.objectContaining({ agui: { emit: expect.any(Function) } })
  );
});

it('selects Dify from trusted config and moderates the actual server-owned query and profile inputs', async () => {
  const app = {
    ...(await resolveAgentApp(APP, 'actor')),
    backendType: 'dify' as const,
    interactionProtocol: 'ag-ui/1.0' as const,
  };
  jest.mocked(resolveAgentApp).mockResolvedValue(app);
  const response = await request('POST', undefined, 'ag-ui/1.0');
  expect(response.statusCode).toBe(200);
  expect(registerSubmission).toHaveBeenCalledWith(
    expect.objectContaining({ backendType: 'dify' })
  );
  expect(reserveRun).toHaveBeenCalledWith(
    expect.objectContaining({ backendType: 'dify' })
  );
  expect(moderateInputText).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'actor',
      text: 'synthetic input\nactor\nuser',
    })
  );
  expect(loadTrustedUserProfile).toHaveBeenCalledWith('actor');
  expect(executeDifyAgentRun).toHaveBeenCalledWith(
    expect.objectContaining({
      app,
      inputs: { agentifui_user_id: 'actor', agentifui_user_role: 'user' },
    })
  );
  expect(executeAgentRun).not.toHaveBeenCalled();
});

it('passes a normalized Dify field and both attachment target shapes through one admission', async () => {
  jest.mocked(resolveAgentApp).mockResolvedValue({
    ...(await resolveAgentApp(APP, 'actor')),
    backendType: 'dify',
    interactionProtocol: 'ag-ui/1.0',
  });
  const secondId = '40000000-0000-4000-8000-000000000002';
  jest.mocked(queryRowsWithPgSystemContext).mockResolvedValue([
    { ...fileRow, slotKey: 'files' },
    { ...fileRow, id: secondId, nativeId: 'other-native-file-id' },
  ]);
  jest.mocked(resolveDifyChatbotInputs).mockResolvedValue(
    normalizeDifyInputCapabilities({
      file_upload: globalDifySlot,
      user_input_form: [
        {
          select: {
            variable: 'format',
            options: ['short', 'long'],
            required: true,
          },
        },
        { file: { ...globalDifySlot, variable: 'reference', required: true } },
      ],
    })
  );
  const attachments = [
    { fileId: FILE, slotKey: 'files' },
    { fileId: secondId, slotKey: 'reference' },
  ];
  const response = await request('POST', undefined, 'ag-ui/1.0', {
    inputs: { format: 'short' },
    attachments,
  });
  expect(response.statusCode).toBe(200);
  expect(registerSubmission).toHaveBeenCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({
        attachments,
        inputs: { format: 'short' },
      }),
    })
  );
  expect(reserveRun).toHaveBeenCalledTimes(1);
  expect(moderateInputText).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'synthetic input\nshort\nactor\nuser' })
  );
  expect(executeDifyAgentRun).toHaveBeenCalledWith(
    expect.objectContaining({
      files: [
        {
          type: 'document',
          transfer_method: 'local_file',
          upload_file_id: 'native-file-id',
        },
      ],
      inputs: expect.objectContaining({
        format: 'short',
        reference: {
          type: 'document',
          transfer_method: 'local_file',
          upload_file_id: 'other-native-file-id',
        },
      }),
    })
  );
  expect(response.body).not.toContain('native-file-id');
});

it('requires Dify query text even with a valid attachment reference', async () => {
  jest.mocked(resolveAgentApp).mockResolvedValue({
    ...(await resolveAgentApp(APP, 'actor')),
    backendType: 'dify',
    interactionProtocol: 'ag-ui/1.0',
  });
  const response = await request('POST', undefined, 'ag-ui/1.0', {
    content: '',
    attachments: [{ fileId: FILE, slotKey: 'files' }],
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().app_error.code).toBe('INPUT_TEXT_INVALID');
  expect(reserveRun).not.toHaveBeenCalled();
});

it('checks LangChain live metadata, sends only native current-turn files, and preserves the empty envelope', async () => {
  jest.mocked(resolveAgentApp).mockResolvedValue({
    ...(await resolveAgentApp(APP, 'actor')),
    assistantId: 'attachment-agent',
  });
  jest.mocked(resolveLangChainInputCapabilities).mockResolvedValue({
    ...normalizeDifyInputCapabilities({}),
    text: { enabled: true, required: false, target: 'content' },
    attachmentSlots: [
      {
        ...normalizeDifyInputCapabilities({ file_upload: globalDifySlot })
          .attachmentSlots[0],
        key: 'reference',
      },
    ],
  });
  jest.mocked(queryRowsWithPgSystemContext).mockResolvedValue([fileRow]);
  jest.mocked(readLangChainInputFileMetadata).mockResolvedValue({
    ...fileRow,
    id: fileRow.nativeId,
  });
  const attachments = [{ fileId: FILE, slotKey: 'reference' }];
  const response = await request('POST', undefined, 'ag-ui/1.0', {
    content: '',
    attachments,
  });
  expect(response.statusCode).toBe(200);
  expect(reserveRun).toHaveBeenCalledWith(
    expect.objectContaining({ content: '', attachments })
  );
  expect(executeAgentRun).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: '',
      inputFiles: [{ fileId: fileRow.nativeId, slotKey: 'reference' }],
    })
  );
  expect((await request('POST', undefined, 'ag-ui/1.0')).statusCode).toBe(200);
  expect(executeAgentRun).toHaveBeenLastCalledWith(
    expect.objectContaining({ inputFiles: [] })
  );
  jest
    .mocked(readLangChainInputFileMetadata)
    .mockRejectedValueOnce(new AgentAppError(404, 'INPUT_FILE_UNAVAILABLE'));
  const expired = await request('POST', undefined, 'ag-ui/1.0', {
    attachments,
  });
  expect(expired.statusCode).toBe(410);
  expect(expired.json().app_error.code).toBe('INPUT_FILE_UNAVAILABLE');
  expect(reserveRun).toHaveBeenCalledTimes(2);
});

it('rejects unrecognized platform file IDs before admission or upstream metadata reads', async () => {
  jest.mocked(resolveAgentApp).mockResolvedValue({
    ...(await resolveAgentApp(APP, 'actor')),
    assistantId: 'attachment-agent',
  });
  jest
    .mocked(resolveLangChainInputCapabilities)
    .mockResolvedValue(
      normalizeDifyInputCapabilities({ file_upload: globalDifySlot })
    );
  const response = await request('POST', undefined, 'ag-ui/1.0', {
    attachments: [{ fileId: FILE, slotKey: 'files' }],
  });
  expect(response.statusCode).toBe(404);
  expect(response.json().app_error.code).toBe('INPUT_FILE_NOT_FOUND');
  expect(readLangChainInputFileMetadata).not.toHaveBeenCalled();
  expect(reserveRun).not.toHaveBeenCalled();
});

it('caps counts and rejects injection or duplicates before native dispatch', async () => {
  jest.mocked(resolveAgentApp).mockResolvedValue({
    ...(await resolveAgentApp(APP, 'actor')),
    assistantId: 'attachment-agent',
  });
  jest.mocked(resolveLangChainInputCapabilities).mockResolvedValue(
    normalizeDifyInputCapabilities({
      file_upload: { ...globalDifySlot, number_limits: 1 },
    })
  );
  const first = { fileId: FILE, slotKey: 'files' };
  const second = { ...first, fileId: RUN };
  for (const extra of [
    { attachments: [first, second] },
    { attachments: [first, first] },
    { attachments: [{ ...first, url: 'https://example.invalid' }] },
    { inputs: { agentifui_user_id: 'injected' } },
  ]) {
    expect(
      (await request('POST', undefined, 'ag-ui/1.0', extra)).statusCode
    ).toBe(400);
  }
  expect(reserveRun).not.toHaveBeenCalled();
  expect(executeAgentRun).not.toHaveBeenCalled();
});

it('uploads via an authenticated multipart route, returns a platform ID, and serves safe archived bytes', async () => {
  jest.mocked(resolveAgentApp).mockResolvedValue({
    ...(await resolveAgentApp(APP, 'actor')),
    backendType: 'dify',
    interactionProtocol: 'ag-ui/1.0',
  });
  jest
    .mocked(resolveDifyChatbotInputs)
    .mockResolvedValue(
      normalizeDifyInputCapabilities({ file_upload: globalDifySlot })
    );
  jest.mocked(uploadDifyChatbotFile).mockResolvedValue(fileRow.nativeId);
  jest
    .mocked(queryRowsWithPgSystemContext)
    .mockResolvedValueOnce([{ id: FILE }]);
  const server = Fastify();
  await server.register(agentRunsRoutes, {
    config: { corsAllowedOrigins: [] } as unknown as ApiRuntimeConfig,
  });
  const url = `/api/internal/apps/${APP}/agent/files`;
  try {
    const form = new FormData();
    form.set(
      'file',
      new File(['<script>'], fileRow.name, { type: 'text/html' })
    );
    form.set('slotKey', 'files');
    const raw = new Response(form);
    const payload = Buffer.from(await raw.arrayBuffer());
    const headers = { 'content-type': raw.headers.get('content-type')! };
    const rejected = await server.inject({
      method: 'POST',
      url,
      payload,
      headers: { ...headers, 'sec-fetch-site': 'cross-site' },
    });
    expect(rejected.statusCode).toBe(403);
    expect(uploadDifyChatbotFile).not.toHaveBeenCalled();
    const uploaded = await server.inject({
      method: 'POST',
      url,
      payload,
      headers,
    });
    expect(uploaded.statusCode).toBe(201);
    const id = uploaded.json().id as string;
    expect(uploaded.json()).toEqual({
      id,
      name: fileRow.name,
      size: fileRow.size,
      type: 'text/html',
    });
    expect(id).not.toBe(fileRow.nativeId);
    expect(saveDifyUpload).toHaveBeenCalledWith(
      { userId: 'actor', serviceInstanceId: APP, fileId: id },
      expect.any(File)
    );
    jest
      .mocked(queryRowsWithPgSystemContext)
      .mockResolvedValue([{ ...fileRow, id, type: 'text/html' }]);
    jest.mocked(readDifyUpload).mockResolvedValue({
      content: Buffer.from('<script>'),
      contentType: 'text/html',
    });
    const bytes = await server.inject(`${url}/${id}`);
    expect(bytes.statusCode).toBe(200);
    expect(bytes.body).toBe('<script>');
    expect(bytes.headers['content-type']).toBe('application/octet-stream');
    expect(bytes.headers['cache-control']).toBe('private, no-store');
    jest.mocked(queryRowsWithPgSystemContext).mockResolvedValueOnce([]);
    expect((await server.inject(`${url}/${id}`)).statusCode).toBe(404);
    expect(readDifyUpload).toHaveBeenCalledTimes(1);
  } finally {
    await server.close();
  }
});

it('rejects Dify protocol omission and moderation blocks without a native dispatch', async () => {
  jest.mocked(resolveAgentApp).mockResolvedValue({
    ...(await resolveAgentApp(APP, 'actor')),
    backendType: 'dify',
    interactionProtocol: 'ag-ui/1.0',
  });
  expect((await request()).statusCode).toBe(409);
  expect(registerSubmission).not.toHaveBeenCalled();
  jest
    .mocked(moderateInputText)
    .mockResolvedValue({ outcome: 'block', categories: ['synthetic'] });
  expect((await request('POST', undefined, 'ag-ui/1.0')).statusCode).toBe(400);
  expect(rejectSubmission).toHaveBeenCalled();
  expect(reserveRun).not.toHaveBeenCalled();
  expect(executeDifyAgentRun).not.toHaveBeenCalled();
});

it('returns an authorized stored replay instead of emitting a new AG-UI run', async () => {
  jest.mocked(registerSubmission).mockResolvedValue({
    task: { root_task_id: 'root-task', run_id: RUN } as never,
    replayed: true,
  });
  jest.mocked(reserveRun).mockResolvedValue({ run, replayed: true });
  const response = await request('POST', undefined, 'ag-ui/1.0');
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({
    code: 'AGENT_SUBMISSION_REPLAY',
    run: { runId: RUN },
  });
  expect(moderateInputText).not.toHaveBeenCalled();
  expect(executeAgentRun).not.toHaveBeenCalled();
});

it.each([
  ['ag-ui/2.0', {}],
  ['ag-ui/1.0', { history: [] }],
  ['ag-ui/1.0', { outputMessageIds: [] }],
  ['ag-ui/1.0', { threadId: 'native-thread' }],
])(
  'rejects unsupported protocol or client-owned execution state (%s)',
  async (protocol, extra) => {
    expect((await request('POST', undefined, protocol, extra)).statusCode).toBe(
      400
    );
    expect(registerSubmission).not.toHaveBeenCalled();
    expect(executeAgentRun).not.toHaveBeenCalled();
  }
);

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
