/** @jest-environment node */
import {
  buildSimplifiedDifyParameters,
  changeInstanceAppType,
  changeInstanceBackend,
  changeInstanceDifyAppType,
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

  it('roundtrips an explicit chatbot opt-in without selecting legacy apps by default', () => {
    const data = createEmptyInstanceFormData();
    expect(data.config).not.toHaveProperty('interaction_protocol');
    data.config.app_metadata.app_type = 'marketplace';
    data.config.interaction_protocol = 'ag-ui/1.0';
    const saved = prepareInstanceFormForSave(data);
    expect(saved.config.interaction_protocol).toBe('ag-ui/1.0');
    expect(
      createInstanceFormDataFromInstance(saved, []).config.interaction_protocol
    ).toBe('ag-ui/1.0');
  });

  it('clears the opt-in when changing backend or leaving chatbot, without restoring it later', () => {
    const data = createEmptyInstanceFormData();
    data.config.app_metadata.app_type = 'marketplace';
    data.config.interaction_protocol = 'ag-ui/1.0';
    const langchain = changeInstanceBackend(data, 'langchain');
    expect(langchain.config).not.toHaveProperty('interaction_protocol');
    expect(changeInstanceBackend(langchain, 'dify').config).not.toHaveProperty(
      'interaction_protocol'
    );
    const agent = changeInstanceDifyAppType(data, 'agent');
    expect(agent.config).not.toHaveProperty('interaction_protocol');
    expect(
      changeInstanceDifyAppType(agent, 'chatbot').config
    ).not.toHaveProperty('interaction_protocol');
    expect(data.config.interaction_protocol).toBe('ag-ui/1.0');
  });

  it('clears a model opt-in on save/readback and does not restore it after switching back to marketplace', () => {
    const data = createEmptyInstanceFormData();
    data.config.interaction_protocol = 'ag-ui/1.0';
    expect(prepareInstanceFormForSave(data).config).not.toHaveProperty(
      'interaction_protocol'
    );
    expect(
      createInstanceFormDataFromInstance(data, []).config
    ).not.toHaveProperty('interaction_protocol');
    data.config.app_metadata.app_type = 'marketplace';
    const model = changeInstanceAppType(data, 'model');
    expect(model.config).not.toHaveProperty('interaction_protocol');
    expect(
      changeInstanceAppType(model, 'marketplace').config
    ).not.toHaveProperty('interaction_protocol');
    expect(data.config.interaction_protocol).toBe('ag-ui/1.0');
  });

  it('does not roundtrip an incompatible stored opt-in or save a stale mode combination', () => {
    const data = createEmptyInstanceFormData();
    data.config.interaction_protocol = 'ag-ui/1.0';
    data.config.app_metadata.dify_apptype = 'workflow';
    expect(prepareInstanceFormForSave(data).config).not.toHaveProperty(
      'interaction_protocol'
    );
    expect(
      createInstanceFormDataFromInstance(data, []).config
    ).not.toHaveProperty('interaction_protocol');
  });
});
