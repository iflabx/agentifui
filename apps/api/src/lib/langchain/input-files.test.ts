/** @jest-environment node */
import { type AgentApp, langChainConfigForActor } from '../agent-app';
import {
  readLangChainInputFile,
  readLangChainInputFileMetadata,
  resolveLangChainInputCapabilities,
  uploadLangChainInputFile,
} from './input-files';
import { LANGCHAIN_INPUT_PROFILE } from './input-profile';
import { createThread, getRun, getThreadState, streamTurn } from './transport';

const app: AgentApp = {
  backendType: 'langchain',
  id: 'app-1',
  instanceId: 'instance-1',
  name: 'Attachment agent',
  baseUrl: 'https://agent.example',
  apiKey: 'synthetic-token',
  assistantId: 'attachment-agent',
  fingerprint: 'synthetic-fingerprint',
};
const pair = { ...app, assistantId: 'attachment-pair-agent' };
const actorId = 'actor-1';
const fileId = '0123456789abcdef0123456789abcdef';
const otherFileId = '1123456789abcdef0123456789abcdef';
const threadId = 'native-thread';
const runId = 'correlation-id';
const nativeRunId = 'native-run';
const profile = {
  profile: LANGCHAIN_INPUT_PROFILE,
  text: { enabled: true, required: false },
  attachmentSlots: [
    {
      key: 'reference',
      required: false,
      minCount: 0,
      maxCount: 3,
      methods: ['local_file'],
      extensions: ['.txt', '.md', '.csv'],
      maxBytesPerFile: 2097152,
    },
  ],
};
const attachment = {
  assistant_id: app.assistantId,
  ag_ui_path: '/ag-ui/attachments',
  inputs: profile,
};
const comparison = {
  assistant_id: pair.assistantId,
  ag_ui_path: '/ag-ui/attachments/pair',
  inputs: {
    ...profile,
    attachmentSlots: [
      {
        ...profile.attachmentSlots[0],
        minCount: 2,
        maxCount: 2,
        required: true,
      },
    ],
  },
};
const legacy = { assistant_id: 'agent', ag_ui_path: '/ag-ui' };
const turn = { threadId, runId, messageId: 'new-user-message', content: '' };
const ref = { fileId, slotKey: 'reference' };
const metadata = {
  ...ref,
  name: "brief (1)'.txt",
  sizeBytes: 7,
  mimeType: 'text/plain',
};

function capabilities(...agents: unknown[]): Response {
  return Response.json({ assistant_id: legacy.assistant_id, agents });
}

function successfulStream(nativeId = nativeRunId): Response {
  const events = [
    { type: 'RUN_STARTED', threadId, runId },
    { type: 'CUSTOM', name: 'native_run', value: { run_id: nativeId } },
    { type: 'RUN_FINISHED', threadId, runId },
  ];
  return new Response(
    events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
    {
      headers: { 'Content-Type': 'text/event-stream' },
    }
  );
}

async function consume(stream: ReturnType<typeof streamTurn>) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

let fetchMock: jest.SpiedFunction<typeof fetch>;

beforeEach(() => {
  fetchMock = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected fetch'));
});

afterEach(() => {
  jest.restoreAllMocks();
});

function expectScope(index: number, actor = actorId, appId = app.id) {
  const init = fetchMock.mock.calls[index][1];
  const headers = new Headers(init?.headers);
  expect(headers.get('Authorization')).toBe('Bearer synthetic-token');
  expect(headers.get('X-AgentifUI-Actor')).toBe(actor);
  expect(headers.get('X-AgentifUI-App')).toBe(appId);
  expect(init?.redirect).toBe('error');
}

it('maps input capabilities only for the exact selected assistant, including pair cardinality', async () => {
  fetchMock.mockImplementation(async () =>
    capabilities(legacy, comparison, attachment)
  );
  await expect(resolveLangChainInputCapabilities(app)).resolves.toMatchObject({
    status: 'ready',
    text: { required: false, enabled: true },
    attachmentSlots: [
      {
        key: 'reference',
        target: 'files',
        minCount: 0,
        maxCount: 3,
        methods: ['local_file'],
        extensions: ['txt', 'md', 'csv'],
        maxBytesByType: { document: 2097152 },
      },
    ],
  });
  await expect(resolveLangChainInputCapabilities(pair)).resolves.toMatchObject({
    status: 'ready',
    attachmentSlots: [{ minCount: 2, maxCount: 2 }],
  });
  await expect(
    resolveLangChainInputCapabilities({ ...app, assistantId: 'agent' })
  ).resolves.toMatchObject({
    status: 'ready',
    text: { enabled: true, required: true },
    attachmentSlots: [],
  });
});

it.each([
  { ...attachment, inputs: undefined },
  { ...attachment, inputs: { ...profile, profile: 'agentifui-input-files/2' } },
  {
    ...attachment,
    inputs: {
      ...profile,
      attachmentSlots: [
        { ...profile.attachmentSlots[0], methods: ['remote_url'] },
      ],
    },
  },
  { ...attachment, ag_ui_path: '/ag-ui/attachments/pair' },
  { ...attachment, ag_ui_path: 'https://untrusted.example/file' },
  { ...attachment, ag_ui_path: '/ag-ui' },
])(
  'fails closed on invalid attachment declarations without dispatch: %p',
  async advertised => {
    fetchMock.mockImplementation(async () =>
      capabilities(legacy, advertised, comparison)
    );
    const beforeDispatch = jest.fn();
    await expect(resolveLangChainInputCapabilities(app)).resolves.toMatchObject(
      { status: 'unsupported', attachmentSlots: [] }
    );
    await expect(
      consume(
        streamTurn(langChainConfigForActor(app, actorId), {
          ...turn,
          inputFiles: [ref],
          beforeDispatch,
        })
      )
    ).rejects.toMatchObject({ code: 'INPUT_PROFILE_UNSUPPORTED' });
    expect(beforeDispatch).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.every(
        ([url]) => url === 'https://agent.example/capabilities'
      )
    ).toBe(true);
  }
);

it('does not borrow the input declaration from a different assistant', async () => {
  fetchMock.mockResolvedValueOnce(capabilities(legacy, comparison));
  await expect(resolveLangChainInputCapabilities(app)).resolves.toMatchObject({
    status: 'unsupported',
    attachmentSlots: [],
  });
});

it('keeps transient capability failures unavailable instead of claiming text-only support', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(resolveLangChainInputCapabilities(app)).resolves.toMatchObject({
    status: 'unavailable',
    attachmentSlots: [],
  });
});

it.each([
  { selected: app, content: '', inputFiles: [ref], path: '/ag-ui/attachments' },
  {
    selected: app,
    content: 'Use prior context',
    inputFiles: [],
    path: '/ag-ui/attachments',
  },
  {
    selected: pair,
    content: '',
    inputFiles: [ref, { ...ref, fileId: otherFileId }],
    path: '/ag-ui/attachments/pair',
  },
])(
  'sends a scoped turn to $path with the exact input envelope',
  async ({ selected, content, inputFiles, path }) => {
    fetchMock
      .mockResolvedValueOnce(capabilities(legacy, attachment, comparison))
      .mockResolvedValueOnce(successfulStream());
    const events = await consume(
      streamTurn(langChainConfigForActor(selected, actorId), {
        ...turn,
        content,
        inputFiles,
      })
    );
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`https://agent.example${path}`);
    expectScope(1);
    expect(JSON.parse(String(init?.body))).toEqual({
      threadId,
      runId,
      messages: [{ id: turn.messageId, role: 'user', content }],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {
        agentifuiInput: {
          profile: LANGCHAIN_INPUT_PROFILE,
          attachments: inputFiles,
        },
      },
    });
    expect(events).toContainEqual({
      type: 'CUSTOM',
      name: 'native_run',
      value: { run_id: nativeRunId },
    });
  }
);

it.each([
  { ...turn, inputFiles: undefined },
  { ...turn, inputFiles: [] },
  { ...turn, inputFiles: [ref, ref] },
  {
    ...turn,
    inputFiles: [ref, { ...ref, slotKey: 'other', fileId: otherFileId }],
  },
  { ...turn, inputFiles: [ref, { ...ref, path: '/tmp/disallowed' }] },
])(
  'rejects missing, duplicate, or invalid references before claiming dispatch',
  async invalid => {
    fetchMock.mockResolvedValueOnce(capabilities(attachment, comparison));
    const beforeDispatch = jest.fn();
    await expect(
      consume(
        streamTurn(langChainConfigForActor(pair, actorId), {
          ...invalid,
          beforeDispatch,
        })
      )
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(beforeDispatch).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }
);

it('does not accept attachment envelopes on the legacy transport', async () => {
  fetchMock.mockResolvedValueOnce(capabilities(legacy, attachment));
  await expect(
    consume(
      streamTurn(
        { ...app, assistantId: 'agent' },
        {
          ...turn,
          content: 'Legacy text',
          inputFiles: [],
        }
      )
    )
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('uses stable actor/app scope for native thread creation, run status and thread state', async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ thread_id: threadId }))
    .mockResolvedValueOnce(
      Response.json({
        thread_id: threadId,
        run_id: nativeRunId,
        status: 'success',
      })
    )
    .mockResolvedValueOnce(Response.json({ values: { consumed: [ref] } }));
  const config = langChainConfigForActor(app, actorId);
  await expect(createThread(config)).resolves.toEqual({ threadId });
  await expect(getRun(config, threadId, nativeRunId)).resolves.toMatchObject({
    runId: nativeRunId,
    status: 'success',
  });
  await expect(getThreadState(config, threadId)).resolves.toEqual({
    values: { consumed: [ref] },
  });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'https://agent.example/threads',
    'https://agent.example/threads/native-thread/runs/native-run',
    'https://agent.example/threads/native-thread/state',
  ]);
  for (const index of [0, 1, 2]) expectScope(index);
});

it('fails closed on missing scope and does not fall back to an unscoped thread', async () => {
  await expect(createThread(app)).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
  });
  await expect(getRun(app, threadId, nativeRunId)).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
  });
  await expect(
    getThreadState(langChainConfigForActor(app, 'invalid actor'), threadId)
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('uploads a single scoped multipart file and returns validated service metadata', async () => {
  const file = new File(['example'], 'brief.txt', { type: 'image/png' });
  fetchMock
    .mockResolvedValueOnce(capabilities(comparison, attachment))
    .mockResolvedValueOnce(
      Response.json({ ...metadata, name: file.name }, { status: 201 })
    );
  await expect(
    uploadLangChainInputFile(pair, actorId, 'reference', file)
  ).resolves.toEqual({
    id: fileId,
    name: file.name,
    size: 7,
    type: 'text/plain',
  });
  const [url, init] = fetchMock.mock.calls[1];
  expect(url).toBe(
    'https://agent.example/assistants/attachment-pair-agent/files'
  );
  expectScope(1);
  expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
  expect([...(init?.body as FormData).entries()]).toEqual([
    ['slotKey', 'reference'],
    ['file', file],
  ]);
});

it('preserves authorized bytes and builds safe headers from scoped metadata', async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json(metadata))
    .mockResolvedValueOnce(
      new Response('example', {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'inline',
          'Set-Cookie': 'upstream=sensitive',
        },
      })
    );
  const response = await readLangChainInputFile(app, actorId, fileId);
  expect(await response.text()).toBe('example');
  expect(response.headers.get('Content-Type')).toBe('text/plain');
  expect(response.headers.get('Content-Disposition')).toBe(
    "attachment; filename=attachment; filename*=UTF-8''brief%20%281%29%27.txt"
  );
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.has('Set-Cookie')).toBe(false);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    `https://agent.example/assistants/attachment-agent/files/${fileId}`,
    `https://agent.example/assistants/attachment-agent/files/${fileId}/content`,
  ]);
  expectScope(0);
  expectScope(1);
});

it.each([
  { actor: 'other-actor', selected: app },
  { actor: actorId, selected: { ...app, id: 'other-app' } },
  { actor: actorId, selected: pair },
])(
  'does not try content or fall back to other scopes after an upstream 404',
  async ({ actor, selected }) => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: 'file_unavailable' } }, { status: 404 })
    );
    await expect(
      readLangChainInputFile(selected, actor, fileId)
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'INPUT_FILE_UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://agent.example/assistants/${selected.assistantId}/files/${fileId}`
    );
    expectScope(0, actor, selected.id);
  }
);

it.each([
  { ...metadata, name: '../brief.txt' },
  { ...metadata, fileId: otherFileId },
  { ...metadata, mimeType: 'text/html' },
  { ...metadata, sizeBytes: 2097153 },
])('rejects inconsistent metadata before reading content', async advertised => {
  fetchMock.mockResolvedValueOnce(Response.json(advertised));
  await expect(
    readLangChainInputFile(app, actorId, fileId)
  ).rejects.toMatchObject({
    statusCode: 503,
    code: 'INPUT_FILE_UPSTREAM_UNAVAILABLE',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('rejects invalid identifiers locally and does not return non-matching content', async () => {
  await expect(
    readLangChainInputFileMetadata(
      app,
      actorId,
      'https://untrusted.example/file'
    )
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock
    .mockResolvedValueOnce(Response.json(metadata))
    .mockResolvedValueOnce(
      new Response('too many bytes', {
        headers: { 'Content-Type': 'text/plain' },
      })
    );
  await expect(
    readLangChainInputFile(app, actorId, fileId)
  ).rejects.toMatchObject({ statusCode: 503 });
});
