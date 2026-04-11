/** @jest-environment node */
import { validateFormData } from '@components/workflow/workflow-input-form/validation';

const t = (key: string, params?: Record<string, string | number | Date>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe('workflow input form validation', () => {
  it('ignores required validation for system-injected user fields', () => {
    expect(
      validateFormData(
        {},
        [
          {
            'text-input': {
              variable: 'agentifui_user_id',
              label: 'Injected User Id',
              required: true,
              default: '',
            },
          },
        ] as never,
        t
      )
    ).toEqual({});
  });

  it('still validates regular visible fields', () => {
    expect(
      validateFormData(
        {},
        [
          {
            'text-input': {
              variable: 'query',
              label: 'Question',
              required: true,
              default: '',
            },
          },
        ] as never,
        t
      )
    ).toEqual({
      query: 'validation.required:{"label":"Question"}',
    });
  });
});
