/** @jest-environment node */
import {
  filterVisibleUserInputForm,
  getDifyUserInputFormEntry,
  isSystemInjectedUserField,
} from './user-input-form';

describe('dify user input form helpers', () => {
  it('identifies system-injected user fields by variable prefix', () => {
    expect(isSystemInjectedUserField('agentifui_user_id')).toBe(true);
    expect(isSystemInjectedUserField(' agentifui_user_role ')).toBe(true);
    expect(isSystemInjectedUserField('query')).toBe(false);
    expect(isSystemInjectedUserField(null)).toBe(false);
  });

  it('extracts the active field type and config from a form item', () => {
    expect(
      getDifyUserInputFormEntry({
        'text-input': {
          variable: 'query',
          label: 'Query',
          required: true,
          default: '',
        },
      } as never)
    ).toEqual({
      fieldType: 'text-input',
      fieldConfig: {
        variable: 'query',
        label: 'Query',
        required: true,
        default: '',
      },
    });
  });

  it('filters system-injected fields from visible user input form items', () => {
    expect(
      filterVisibleUserInputForm([
        {
          'text-input': {
            variable: 'agentifui_user_id',
            label: 'Injected User Id',
            required: true,
            default: '',
          },
        },
        {
          paragraph: {
            variable: 'query',
            label: 'Question',
            required: true,
            default: '',
          },
        },
      ] as never)
    ).toEqual([
      {
        paragraph: {
          variable: 'query',
          label: 'Question',
          required: true,
          default: '',
        },
      },
    ]);
  });
});
