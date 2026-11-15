/** @jest-environment node */
import { publicAppConfig } from './public-app-config';

describe('public interaction protocol configuration', () => {
  it('publishes only the explicit Dify chatbot opt-in without mutating config', () => {
    const config = {
      interaction_protocol: 'ag-ui/1.0',
      app_metadata: { app_type: 'marketplace', dify_apptype: 'chatbot' },
      dify_parameters: { opening_statement: 'Hello' },
    };
    expect(publicAppConfig(config)).toEqual(config);
    expect(publicAppConfig(null)).toEqual({});
  });

  it.each([
    {
      interaction_protocol: 'future',
      app_metadata: { dify_apptype: 'chatbot' },
    },
    {
      interaction_protocol: 'ag-ui/1.0',
      app_metadata: { dify_apptype: 'agent' },
    },
    { interaction_protocol: 'ag-ui/1.0' },
    {
      interaction_protocol: 'ag-ui/1.0',
      app_metadata: { app_type: 'model', dify_apptype: 'chatbot' },
    },
    {
      interaction_protocol: 'ag-ui/1.0',
      app_metadata: { dify_apptype: 'chatbot' },
    },
  ])('does not advertise an invalid or incompatible opt-in: %p', config => {
    expect(publicAppConfig(config)).not.toHaveProperty('interaction_protocol');
    expect(config).toHaveProperty('interaction_protocol');
  });

  it('keeps LangChain display config allowlisted and ignores a stale Dify opt-in', () => {
    const result = publicAppConfig({
      backend_type: 'langchain',
      interaction_protocol: 'ag-ui/1.0',
      api_url: 'https://private.example.test',
      langchain: { assistant_id: 'agent', token: 'not-public' },
    });
    expect(result.backend_type).toBe('langchain');
    expect(result).not.toHaveProperty('api_url');
    expect(result).not.toHaveProperty('interaction_protocol');
    expect(result.langchain).not.toHaveProperty('token');
  });
});
