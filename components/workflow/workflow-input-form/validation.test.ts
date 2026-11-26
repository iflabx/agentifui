import type {
  AgentAttachmentSlot,
  AgentInputCapabilities,
} from '../../../packages/shared/src/agent-input';
import { capabilityFormFields, validateFormData } from './validation';

const slot: AgentAttachmentSlot = {
  key: 'Exact_Docs',
  label: 'Docs',
  target: 'inputs',
  minCount: 1,
  maxCount: 3,
  methods: ['local_file'],
  allowedTypes: ['document'],
  extensions: ['md'],
  maxBytesByType: { document: 4 },
};
const capabilities: AgentInputCapabilities = {
  version: 1,
  status: 'ready',
  mode: 'task',
  text: { enabled: false, required: false, target: 'query' },
  fields: [],
  attachmentSlots: [slot, { ...slot, key: 'other', minCount: 2, maxCount: 2 }],
};
const t = (key: string) => key;
const uploaded = (id: string, size = 4) => ({
  upload_file_id: id,
  name: 'doc.md',
  size,
  mime_type: '',
});

describe('workflow slot validation', () => {
  it('keeps a file-list array even when its capacity is one', () => {
    const list = {
      ...capabilities,
      attachmentSlots: [{ ...slot, maxCount: 1, multiple: true }],
    };
    const form = capabilityFormFields(list);
    expect(form[0]).toHaveProperty('file-list');
    expect(form[0]).not.toHaveProperty('file');
    expect(
      validateFormData({ Exact_Docs: [uploaded('one')] }, form, t, list)
    ).toEqual({});
  });
  it('preserves live numeric constraints in the existing numeric form and validator', () => {
    const numeric: AgentInputCapabilities = {
      ...capabilities,
      attachmentSlots: [],
      fields: [
        {
          key: 'Count',
          label: 'Count',
          type: 'number',
          required: true,
          min: 2,
          max: 10,
          step: 2,
          precision: 1,
        },
      ],
    };
    const form = capabilityFormFields(numeric);
    expect(form[0].number).toMatchObject({
      variable: 'Count',
      min: 2,
      max: 10,
      step: 2,
      precision: 1,
    });
    expect(validateFormData({ Count: 0 }, form, t, numeric)).toEqual({
      Count: 'validation.minValue',
    });
    expect(validateFormData({ Count: 11 }, form, t, numeric)).toEqual({
      Count: 'validation.maxValue',
    });
    expect(validateFormData({ Count: 3 }, form, t, numeric)).toEqual({
      Count: 'validation.stepValue',
    });
    expect(validateFormData({ Count: 4 }, form, t, numeric)).toEqual({});
  });
  it('retains case-sensitive variable keys and required minimums on separate slots', () => {
    const form = capabilityFormFields(capabilities);
    expect(form).toEqual([
      {
        'file-list': expect.objectContaining({
          variable: 'Exact_Docs',
          required: true,
          number_limits: 3,
        }),
      },
      {
        'file-list': expect.objectContaining({
          variable: 'other',
          required: true,
          number_limits: 2,
        }),
      },
    ]);
    expect(validateFormData({}, form, t, capabilities)).toEqual({
      Exact_Docs: 'validation.required',
      other: 'validation.required',
    });
    expect(
      validateFormData(
        { Exact_Docs: [uploaded('1')], other: [uploaded('2'), uploaded('3')] },
        form,
        t,
        capabilities
      )
    ).toEqual({});
    expect(
      validateFormData(
        { Exact_Docs: [uploaded('1')], other: [uploaded('2')] },
        form,
        t,
        capabilities
      )
    ).toEqual({ other: 'validation.required' });
  });
  it('enforces per-slot maxima, including a single file, and does not borrow capacity', () => {
    const single = {
      ...capabilities,
      attachmentSlots: [{ ...slot, maxCount: 1 }],
    };
    expect(capabilityFormFields(single)[0]).toHaveProperty('file');
    expect(
      validateFormData(
        { Exact_Docs: [uploaded('1'), uploaded('2')] },
        capabilityFormFields(single),
        t,
        single
      )
    ).toEqual({ Exact_Docs: 'validation.tooManyFiles' });
  });
  it.each([
    [uploaded('id', 5), 'INPUT_FILE_SIZE'],
    [{ ...uploaded('id'), name: 'bad.png' }, 'INPUT_FILE_TYPE'],
    [{ upload_file_id: 'id' }, 'INPUT_FILE_TYPE'],
    [new File(['ok'], 'file.md'), 'INPUT_UPLOAD_PENDING'],
  ])(
    'validates raw and already uploaded files with the shared validator',
    (file, error) => {
      const one = { ...capabilities, attachmentSlots: [slot] };
      expect(
        validateFormData(
          { Exact_Docs: [file] },
          capabilityFormFields(one),
          t,
          one
        )
      ).toEqual({ Exact_Docs: error });
    }
  );
  it('rejects duplicated IDs rather than satisfying exact count with one file twice', () => {
    const exact = {
      ...capabilities,
      attachmentSlots: [{ ...slot, minCount: 2, maxCount: 2 }],
    };
    expect(
      validateFormData(
        { Exact_Docs: [uploaded('same'), uploaded('same')] },
        capabilityFormFields(exact),
        t,
        exact
      )
    ).toEqual({ Exact_Docs: 'INPUT_FILE_REFERENCE_INVALID' });
  });
  it('never accepts raw static configuration without resolved live limits', () => {
    expect(
      validateFormData(
        { Exact_Docs: [uploaded('id')] },
        capabilityFormFields(capabilities),
        t
      )
    ).toHaveProperty('Exact_Docs', 'INPUT_CAPABILITIES_UNAVAILABLE');
  });
});
