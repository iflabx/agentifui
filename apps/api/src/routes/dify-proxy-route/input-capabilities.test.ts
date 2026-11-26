/** @jest-environment node */
import {
  normalizeDifyInputCapabilities,
  resolveDifyInputCapabilities,
} from '../../lib/dify-input-capabilities';
import { loadDifyUploadMetadata } from '../../lib/dify-upload-access';
import {
  validateDifyGenerationInput,
  validateDifyInputUpload,
} from './input-capabilities';
import type { DifyProxyRequestContext, DifyProxyTargetConfig } from './types';

jest.mock('../../lib/dify-input-capabilities', () => ({
  ...jest.requireActual('../../lib/dify-input-capabilities'),
  resolveDifyInputCapabilities: jest.fn(),
}));
jest.mock('../../lib/dify-upload-access', () => ({
  loadDifyUploadMetadata: jest.fn(),
}));
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

const target: DifyProxyTargetConfig = {
  serviceInstanceId: 'app',
  difyApiUrl: 'https://agent.example/v1',
  difyApiKey: 'synthetic-fixture',
  tempConfigUsed: false,
  rawBody: {},
};
const context: DifyProxyRequestContext = {
  appId: 'native',
  slug: ['chat-messages'],
  routePath: '',
  actor: { userId: 'actor', role: 'user' },
};
const fileConfig = {
  enabled: true,
  number_limits: 3,
  allowed_file_types: ['document'],
  allowed_file_upload_methods: ['local_file'],
};
const ref = (id = 'file-1') => ({
  type: 'document',
  transfer_method: 'local_file',
  upload_file_id: id,
});
const validate = (body: unknown) =>
  validateDifyGenerationInput(body, context, target);

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(resolveDifyInputCapabilities)
    .mockResolvedValue(
      normalizeDifyInputCapabilities({ file_upload: fileConfig })
    );
  jest
    .mocked(loadDifyUploadMetadata)
    .mockResolvedValue({ name: 'source.txt', size: 10, type: 'text/plain' });
});

it('accepts optional zero files and correctly scoped registered files', async () => {
  await expect(validate({ files: [] })).resolves.toBeUndefined();
  await expect(validate({ files: [ref()] })).resolves.toBeUndefined();
  expect(loadDifyUploadMetadata).toHaveBeenCalledWith({
    userId: 'actor',
    serviceInstanceId: 'app',
    fileId: 'file-1',
  });
});

it('reuses omitted Chatflow variables only for an owned existing native conversation', async () => {
  jest.mocked(resolveDifyInputCapabilities).mockResolvedValue(
    normalizeDifyInputCapabilities(
      {
        user_input_form: [
          { file: { ...fileConfig, variable: 'source', required: true } },
        ],
      },
      'chatflow'
    )
  );
  const chatflow = { ...target, appType: 'chatflow' };
  const fetchMock = jest.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [
          {
            inputs: {
              source: {
                type: 'document',
                transfer_method: 'local_file',
                related_id: 'file-1',
              },
            },
          },
        ],
      })
    )
  );
  global.fetch = fetchMock;
  const body = { conversation_id: 'existing', inputs: {} };
  await expect(
    validateDifyGenerationInput(body, context, chatflow)
  ).resolves.toBeUndefined();
  expect(body.inputs).toEqual({ source: ref() });
  const requested = fetchMock.mock.calls[0][0] as URL;
  expect(requested.pathname).toBe('/v1/messages');
  expect(requested.searchParams.get('user')).toBe('actor');
  expect(requested.searchParams.get('conversation_id')).toBe('existing');
  expect(loadDifyUploadMetadata).toHaveBeenCalledWith({
    userId: 'actor',
    serviceInstanceId: 'app',
    fileId: 'file-1',
  });
  await expect(
    validateDifyGenerationInput({ inputs: {} }, context, chatflow)
  ).rejects.toMatchObject({ code: 'INPUT_FILES_REQUIRED' });
  await expect(
    validateDifyGenerationInput(
      { conversation_id: 'existing', inputs: { source: [] } },
      context,
      chatflow
    )
  ).rejects.toMatchObject({ code: 'INPUT_FILES_REQUIRED' });
  await expect(
    validateDifyGenerationInput(
      { conversation_id: 'existing', inputs: { source: ref() } },
      context,
      chatflow
    )
  ).resolves.toBeUndefined();
  fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
  await expect(
    validateDifyGenerationInput(
      { conversation_id: 'foreign', inputs: {} },
      context,
      chatflow
    )
  ).rejects.toMatchObject({
    statusCode: 403,
    code: 'INPUT_CONVERSATION_UNAVAILABLE',
  });
});

it('rejects excess counts before querying uploads', async () => {
  await expect(
    validate({ files: [ref('a'), ref('b'), ref('c'), ref('d')] })
  ).rejects.toMatchObject({ code: 'INPUT_TOO_MANY_FILES' });
  expect(loadDifyUploadMetadata).not.toHaveBeenCalled();
});

it('rejects another user/app file, unregistered file or unverifiable historical metadata', async () => {
  jest.mocked(loadDifyUploadMetadata).mockResolvedValue(null);
  await expect(validate({ files: [ref()] })).rejects.toMatchObject({
    code: 'INPUT_FILE_REATTACH_REQUIRED',
  });
});

it('does not trust client size, filename or claimed native type', async () => {
  jest.mocked(loadDifyUploadMetadata).mockResolvedValue({
    name: 'source.txt',
    size: 20 * 1024 * 1024,
    type: 'text/plain',
  });
  await expect(
    validate({ files: [{ ...ref(), size: 1 }] })
  ).rejects.toMatchObject({ code: 'INPUT_FILE_SIZE' });
  jest
    .mocked(loadDifyUploadMetadata)
    .mockResolvedValue({ name: 'source.txt', size: 10, type: 'text/plain' });
  await expect(
    validate({ files: [{ ...ref(), type: 'image' }] })
  ).rejects.toMatchObject({ code: 'INPUT_FILE_TYPE' });
});

it('rejects duplicate references and undeclared input slots', async () => {
  await expect(validate({ files: [ref(), ref()] })).rejects.toMatchObject({
    code: 'INPUT_FILE_DUPLICATE',
  });
  await expect(validate({ inputs: { hidden: [ref()] } })).rejects.toMatchObject(
    { code: 'INPUT_FILE_SLOT_INVALID' }
  );
});

it('allows independent native and variable slots both named files', async () => {
  jest.mocked(resolveDifyInputCapabilities).mockResolvedValue(
    normalizeDifyInputCapabilities({
      file_upload: fileConfig,
      user_input_form: [
        { file: { ...fileConfig, variable: 'files', required: true } },
      ],
    })
  );
  await expect(
    validate({ files: [ref()], inputs: { files: ref() } })
  ).resolves.toBeUndefined();
});

it('checks required and separate field slots with the original case', async () => {
  jest.mocked(resolveDifyInputCapabilities).mockResolvedValue(
    normalizeDifyInputCapabilities(
      {
        user_input_form: [
          { file: { ...fileConfig, variable: 'ContractA', required: true } },
          {
            'file-list': {
              ...fileConfig,
              variable: 'Reference',
              max_length: 2,
            },
          },
        ],
      },
      'workflow'
    )
  );
  await expect(
    validate({ inputs: { contracta: ref() } })
  ).rejects.toMatchObject({ code: 'INPUT_FILES_REQUIRED' });
  await expect(
    validate({ inputs: { ContractA: ref(), Reference: [ref('b'), ref('c')] } })
  ).resolves.toBeUndefined();
});

it('fails closed when discovery is unavailable without calling file storage', async () => {
  jest.mocked(resolveDifyInputCapabilities).mockResolvedValue({
    ...normalizeDifyInputCapabilities({}),
    status: 'unavailable',
  });
  await expect(validate({ query: 'test' })).rejects.toMatchObject({
    statusCode: 503,
  });
  expect(loadDifyUploadMetadata).not.toHaveBeenCalled();
});

it('validates actual upload bytes/name and exactly one multipart file', async () => {
  const form = new FormData();
  form.append(
    'file',
    new File(['hello'], 'source.txt', { type: 'text/plain' })
  );
  await expect(validateDifyInputUpload(form, target)).resolves.toBeUndefined();
  form.append('file', new File(['hello'], 'other.txt'));
  await expect(validateDifyInputUpload(form, target)).rejects.toMatchObject({
    code: 'INPUT_UPLOAD_INVALID',
  });
  const rejected = new FormData();
  rejected.append('file', new File(['hello'], 'source.exe'));
  await expect(validateDifyInputUpload(rejected, target)).rejects.toMatchObject(
    { code: 'INPUT_FILE_NOT_ALLOWED' }
  );
});
