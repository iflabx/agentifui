/** @jest-environment node */
import {
  buildSimplifiedDifyParameters,
  changeInstanceBackend,
  createEmptyInstanceFormData,
  createInstanceFormDataFromInstance,
  getInitialProviderId,
  prepareInstanceFormForSave,
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

  it('treats legacy instances as Dify and preserves their parameters', () => {
    const data = createInstanceFormDataFromInstance(
      {
        instance_id: 'legacy',
        config: {
          app_metadata: {
            app_type: 'model',
            dify_apptype: 'agent',
            tags: ['old'],
          },
          dify_parameters: { opening_statement: 'Welcome' },
        },
      },
      []
    );
    expect(prepareInstanceFormForSave(data).config).toMatchObject({
      backend_type: 'dify',
      app_metadata: { app_type: 'model', dify_apptype: 'agent', tags: ['old'] },
      dify_parameters: { opening_statement: 'Welcome' },
    });
  });

  it('roundtrips LangChain as marketplace without Dify fields or credentials in config', () => {
    const data = createInstanceFormDataFromInstance(
      {
        provider_id: 'provider',
        instance_id: ' assistant ',
        config: {
          backend_type: 'langchain',
          langchain: { assistant_id: ' custom-agent ' },
          app_metadata: {
            app_type: 'model',
            dify_apptype: 'chatbot',
            tags: ['tools'],
          },
          dify_parameters: { opening_statement: 'stale' },
        },
      },
      [{ id: 'provider', base_url: 'https://agent.example.test' }] as never
    );
    data.apiKey = 'test-credential';
    const saved = prepareInstanceFormForSave(data);
    expect(saved).toMatchObject({
      instance_id: 'assistant',
      apiKey: 'test-credential',
      is_default: false,
    });
    expect(saved.config).toEqual({
      backend_type: 'langchain',
      api_url: 'https://agent.example.test',
      langchain: { assistant_id: 'custom-agent' },
      app_metadata: {
        app_type: 'marketplace',
        is_marketplace_app: true,
        tags: ['tools'],
      },
    });
    expect(createInstanceFormDataFromInstance(saved, []).config).toEqual(
      saved.config
    );
  });

  it('clears incompatible settings when switching backend in either direction', () => {
    const original = createEmptyInstanceFormData();
    original.config.dify_parameters = { opening_statement: 'Dify' };
    const langchain = changeInstanceBackend(original, 'langchain');
    expect(langchain.config.langchain).toEqual({ assistant_id: 'agent' });
    expect(langchain.config.dify_parameters).toBeUndefined();
    expect(langchain.config.app_metadata.dify_apptype).toBeUndefined();
    expect(original.config.dify_parameters).toEqual({
      opening_statement: 'Dify',
    });
    const dify = changeInstanceBackend(langchain, 'dify');
    expect(dify.config.langchain).toBeUndefined();
    expect(dify.config.app_metadata.dify_apptype).toBe('chatbot');
    expect(dify.config.dify_parameters).toEqual({});
  });

  it('does not replace an empty assistant ID with the default during save', () => {
    const data = changeInstanceBackend(
      createEmptyInstanceFormData(),
      'langchain'
    );
    data.config.langchain = { assistant_id: '   ' };
    expect(prepareInstanceFormForSave(data).config.langchain).toEqual({
      assistant_id: '',
    });
  });
});
