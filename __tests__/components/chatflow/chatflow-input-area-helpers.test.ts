/** @jest-environment node */
import {
  buildChatflowFormConfig,
  extractFilesFromFormData,
  isChatflowFormPristine,
  validateChatflowSubmission,
} from '@components/chatflow/chatflow-input-area/helpers';

const t = (key: string, params?: Record<string, string | number | Date>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe('chatflow input area helpers', () => {
  it('builds initial form data from user input form config', () => {
    const result = buildChatflowFormConfig([
      { 'text-input': { variable: 'name', label: 'Name', default: 'Alice' } },
      { number: { variable: 'age', label: 'Age', default: 18 } },
      { file: { variable: 'resume', label: 'Resume', default: [] } },
    ] as never);

    expect(result.hasFormConfig).toBe(true);
    expect(result.initialFormData).toEqual({
      name: 'Alice',
      age: 18,
      resume: [],
    });
  });

  it('filters system-injected user fields from chatflow form config', () => {
    const result = buildChatflowFormConfig([
      {
        'text-input': {
          variable: 'agentifui_user_id',
          label: 'Injected User Id',
          default: '',
        },
      },
      {
        paragraph: {
          variable: 'note',
          label: 'Note',
          default: 'hello',
        },
      },
    ] as never);

    expect(result.hasFormConfig).toBe(true);
    expect(result.userInputForm).toEqual([
      {
        paragraph: {
          variable: 'note',
          label: 'Note',
          default: 'hello',
        },
      },
    ]);
    expect(result.initialFormData).toEqual({
      note: 'hello',
    });
  });

  it('treats hidden-only system fields as no visible chatflow form config', () => {
    const result = buildChatflowFormConfig([
      {
        'text-input': {
          variable: 'agentifui_user_role',
          label: 'Injected User Role',
          default: '',
        },
      },
    ] as never);

    expect(result).toEqual({
      hasFormConfig: false,
      initialFormData: {},
      userInputForm: [],
    });
  });

  it('validates query and workflow form fields', () => {
    expect(
      validateChatflowSubmission({
        formData: {},
        hasFormConfig: false,
        query: '',
        t,
        tWorkflow: t,
        userInputForm: [],
      })
    ).toEqual({ query: 'form.question.required' });

    const tooLong = validateChatflowSubmission({
      formData: {},
      hasFormConfig: false,
      query: 'a'.repeat(2001),
      t,
      tWorkflow: t,
      userInputForm: [],
    });
    expect(tooLong.query).toContain('form.question.tooLong');
  });

  it('extracts upload payload files and detects pristine form state', () => {
    expect(
      extractFilesFromFormData({
        single: { upload_file_id: 'file-1' },
        multi: [{ upload_file_id: 'file-2' }, { foo: 'bar' }],
        other: 'text',
      })
    ).toEqual([{ upload_file_id: 'file-1' }, { upload_file_id: 'file-2' }]);

    expect(isChatflowFormPristine('', { a: '', b: [] })).toBe(true);
    expect(isChatflowFormPristine('hello', { a: '' })).toBe(false);
    expect(isChatflowFormPristine('', { a: ['x'] })).toBe(false);
  });
});
