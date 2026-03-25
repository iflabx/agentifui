/** @jest-environment node */
import {
  buildSimplifiedDifyParameters,
  createEmptyInstanceFormData,
  getInitialProviderId,
  validateInstanceIdValue,
} from '@components/admin/api-config/instance-form-utils';

describe('instance form utils', () => {
  it('returns the first matching active provider for the current filter', () => {
    expect(
      getInitialProviderId(
        [
          { id: '1', name: 'Other', is_active: true },
          { id: '2', name: 'Dify', is_active: true },
        ] as never,
        '2'
      )
    ).toBe('2');
  });

  it('validates instance ids with specific format errors', () => {
    const messages = {
      noSpaces: 'no spaces',
      invalidChars: 'invalid chars',
      tooLong: 'too long',
      mustStartWithAlphanumeric: 'must start alnum',
    };

    expect(validateInstanceIdValue(' bad id', messages)).toBe('no spaces');
    expect(validateInstanceIdValue('@bad', messages)).toBe('invalid chars');
    expect(validateInstanceIdValue(`a${'b'.repeat(50)}`, messages)).toBe(
      'too long'
    );
    expect(validateInstanceIdValue('-bad', messages)).toBe('must start alnum');
    expect(validateInstanceIdValue('good-id', messages)).toBe('');
  });

  it('builds simplified dify parameters with defaults', () => {
    expect(buildSimplifiedDifyParameters({} as never)).toMatchObject({
      opening_statement: '',
      suggested_questions: [],
      speech_to_text: { enabled: false },
      system_parameters: {
        file_size_limit: 15,
        image_file_size_limit: 10,
        audio_file_size_limit: 50,
        video_file_size_limit: 100,
      },
    });
  });

  it('creates a stable empty form data shape', () => {
    expect(createEmptyInstanceFormData()).toMatchObject({
      instance_id: '',
      display_name: '',
      config: {
        api_url: '',
        app_metadata: {
          app_type: 'model',
          dify_apptype: 'chatbot',
          tags: [],
        },
      },
    });
  });
});
