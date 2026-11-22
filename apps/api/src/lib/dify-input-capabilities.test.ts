/** @jest-environment node */
import { validateInputFile, validateInputFileCount } from '@agentifui/shared';

import {
  clearDifyInputCapabilitiesCache,
  normalizeDifyInputCapabilities,
  resolveDifyInputCapabilities,
} from './dify-input-capabilities';

const upload = {
  enabled: true,
  allowed_file_types: ['document'],
  allowed_file_upload_methods: ['local_file'],
  number_limits: 3,
};

describe('Dify effective input capabilities', () => {
  it('preserves text-only behavior without enabling uploads', () => {
    expect(normalizeDifyInputCapabilities({})).toMatchObject({
      status: 'ready',
      text: { enabled: true, required: true },
      attachmentSlots: [],
    });
    expect(normalizeDifyInputCapabilities(null).status).toBe('unavailable');
  });

  it.each([0, 1, 3])(
    'keeps optional counts distinct from the maximum %i',
    maximum => {
      const slot = normalizeDifyInputCapabilities({
        file_upload: { ...upload, number_limits: maximum },
      }).attachmentSlots[0];
      expect(slot).toMatchObject({
        minCount: 0,
        maxCount: maximum,
        target: 'files',
      });
      expect(validateInputFileCount(slot, 0)).toBeNull();
      expect(validateInputFileCount(slot, maximum + 1)).toBe(
        'INPUT_TOO_MANY_FILES'
      );
    }
  );

  it('uses the Dify protocol default of three files only for the message slot', () => {
    expect(
      normalizeDifyInputCapabilities({
        file_upload: { ...upload, number_limits: undefined },
      }).attachmentSlots[0].maxCount
    ).toBe(3);
    expect(
      normalizeDifyInputCapabilities({
        user_input_form: [
          {
            'file-list': {
              ...upload,
              number_limits: undefined,
              variable: 'source',
            },
          },
        ],
      }).status
    ).toBe('unavailable');
  });

  it.each([-1, 1.5, '3', null])(
    'does not interpret invalid count %j as unlimited',
    number_limits => {
      expect(
        normalizeDifyInputCapabilities({
          file_upload: { ...upload, number_limits },
        }).status
      ).toBe('unavailable');
    }
  );

  it('preserves exact variables, independent required slots, and native task mode', () => {
    const result = normalizeDifyInputCapabilities(
      {
        user_input_form: [
          {
            file: {
              ...upload,
              variable: 'ContractA',
              label: 'Contract',
              required: true,
            },
          },
          {
            'file-list': {
              ...upload,
              variable: 'ReferenceFiles',
              required: false,
              max_length: 3,
            },
          },
          {
            paragraph: {
              variable: 'RequestText',
              label: 'Question',
              required: true,
            },
          },
        ],
      },
      'workflow'
    );
    expect(result).toMatchObject({
      status: 'ready',
      mode: 'task',
      text: { enabled: false },
    });
    expect(
      result.attachmentSlots.map(slot => [
        slot.key,
        slot.minCount,
        slot.maxCount,
      ])
    ).toEqual([
      ['ContractA', 1, 1],
      ['ReferenceFiles', 0, 3],
    ]);
    expect(result.fields[0].key).toBe('RequestText');
  });

  it('supports a custom extension not in the static display catalog', () => {
    const slot = normalizeDifyInputCapabilities({
      file_upload: {
        ...upload,
        allowed_file_types: ['custom'],
        allowed_file_extensions: ['.XYZ'],
      },
    }).attachmentSlots[0];
    expect(validateInputFile(slot, { name: 'test.XYZ', size: 12 })).toBeNull();
    expect(validateInputFile(slot, { name: 'test.pdf', size: 12 })).toBe(
      'INPUT_FILE_TYPE'
    );
  });

  it('enforces the intersection of upstream and platform size limits at the boundary', () => {
    const slot = normalizeDifyInputCapabilities(
      { file_upload: upload, system_parameters: { file_size_limit: 1 } },
      'chatflow',
      512
    ).attachmentSlots[0];
    expect(validateInputFile(slot, { name: 'test.txt', size: 512 })).toBeNull();
    expect(validateInputFile(slot, { name: 'test.txt', size: 513 })).toBe(
      'INPUT_FILE_SIZE'
    );
  });

  it('does not let field/custom limits relax applicable per-type system limits', () => {
    const slot = normalizeDifyInputCapabilities({
      file_upload: {
        ...upload,
        allowed_file_types: ['image', 'custom'],
        allowed_file_extensions: ['.png'],
        max_file_size_mb: 15,
      },
      system_parameters: { image_file_size_limit: 10 },
    }).attachmentSlots[0];
    expect(
      validateInputFile(slot, { name: 'photo.png', size: 12 * 1024 * 1024 })
    ).toBe('INPUT_FILE_SIZE');
    expect(
      validateInputFile(slot, { name: 'photo.png', size: 10 * 1024 * 1024 })
    ).toBeNull();
  });

  it('distinguishes native files from an input variable named files', () => {
    const result = normalizeDifyInputCapabilities({
      file_upload: upload,
      user_input_form: [{ file: { ...upload, variable: 'files' } }],
    });
    expect(result.status).toBe('ready');
    expect(result.attachmentSlots.map(slot => slot.target)).toEqual([
      'files',
      'inputs',
    ]);
  });

  it('does not enable local files for remote-only slots', () => {
    const slot = normalizeDifyInputCapabilities({
      file_upload: {
        ...upload,
        allowed_file_upload_methods: ['remote_url'],
      },
    }).attachmentSlots[0];
    expect(validateInputFile(slot, { name: 'test.txt', size: 12 })).toBe(
      'INPUT_UPLOAD_DISABLED'
    );
  });

  it('blocks unknown required fields but allows an optional unsupported field', () => {
    for (const required of [true, false]) {
      expect(
        normalizeDifyInputCapabilities({
          user_input_form: [{ future: { variable: 'v', required } }],
        }).status
      ).toBe(required ? 'unsupported' : 'ready');
    }
  });

  it('rejects malformed limits, duplicate slots and custom types with no extension', () => {
    expect(
      normalizeDifyInputCapabilities({
        file_upload: { ...upload, allowed_file_types: ['custom'] },
      }).status
    ).toBe('unavailable');
    expect(
      normalizeDifyInputCapabilities({
        file_upload: upload,
        system_parameters: { file_size_limit: -1 },
      }).status
    ).toBe('unavailable');
    expect(
      normalizeDifyInputCapabilities({
        user_input_form: [
          { file: { ...upload, variable: 'same' } },
          { file: { ...upload, variable: 'same' } },
        ],
      }).status
    ).toBe('unavailable');
  });
});

describe('live capability cache', () => {
  const originalFetch = global.fetch;
  const target = {
    difyApiUrl: 'https://agent.example/v1',
    difyApiKey: 'synthetic-fixture',
    appType: 'chatflow',
  };
  beforeEach(() => {
    clearDifyInputCapabilitiesCache();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('deduplicates concurrent reads and refreshes after TTL or credential/config change', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(
      async () => new Response(JSON.stringify({ file_upload: upload }))
    );
    global.fetch = fetchMock;
    await Promise.all([
      resolveDifyInputCapabilities(target),
      resolveDifyInputCapabilities(target),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60001);
    await resolveDifyInputCapabilities(target);
    await resolveDifyInputCapabilities({
      ...target,
      credentialVersion: 'next',
    });
    await resolveDifyInputCapabilities({ ...target, appType: 'workflow' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not cache a network error as no file support', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(new Response('{}'));
    global.fetch = fetchMock;
    expect((await resolveDifyInputCapabilities(target)).status).toBe(
      'unavailable'
    );
    expect((await resolveDifyInputCapabilities(target)).status).toBe('ready');
  });

  it('does not reuse or cache a read from before invalidation', async () => {
    let resolveOld!: (value: Response) => void;
    let resolveNew!: (value: Response) => void;
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>(resolve => {
            resolveOld = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>(resolve => {
            resolveNew = resolve;
          })
      );
    global.fetch = fetchMock;
    const oldRead = resolveDifyInputCapabilities(target);
    clearDifyInputCapabilitiesCache();
    const newRead = resolveDifyInputCapabilities(target);
    resolveOld(new Response(JSON.stringify({ file_upload: upload })));
    await oldRead;
    const concurrentNewRead = resolveDifyInputCapabilities(target);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveNew(new Response('{}'));
    expect((await newRead).attachmentSlots).toEqual([]);
    expect((await concurrentNewRead).attachmentSlots).toEqual([]);
    expect(
      (await resolveDifyInputCapabilities(target)).attachmentSlots
    ).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the supported minimum multipart budget usable for tiny files', async () => {
    const original = process.env.DIFY_UPLOAD_MAX_BYTES;
    process.env.DIFY_UPLOAD_MAX_BYTES = '1024';
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ file_upload: upload }))
    );
    try {
      const result = await resolveDifyInputCapabilities(target);
      const slot = result.attachmentSlots[0];
      expect(result.status).toBe('ready');
      expect(slot.maxBytesByType.document).toBe(768);
      expect(
        validateInputFile(slot, { name: 'source.txt', size: 12 })
      ).toBeNull();
    } finally {
      if (original === undefined) delete process.env.DIFY_UPLOAD_MAX_BYTES;
      else process.env.DIFY_UPLOAD_MAX_BYTES = original;
    }
  });
});
