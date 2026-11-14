/** @jest-environment node */
import {
  describeBackend,
  isDifyGeneration,
  resolveBackendType,
} from './agent-backends';
import { publicAppConfig } from './public-app-config';

describe('backend selection and public capabilities', () => {
  it('separates backend cancellation support from effective role and application actions', () => {
    const workflow = { app_metadata: { dify_apptype: 'workflow' } };
    expect(describeBackend(workflow, 'user')).toMatchObject({
      capabilities: { cancellation: true },
      effectiveActions: { cancellation: false },
    });
    expect(
      describeBackend(workflow, 'admin').effectiveActions.cancellation
    ).toBe(true);
    expect(
      describeBackend({ app_metadata: { dify_apptype: 'chatbot' } }, 'user')
        .effectiveActions.cancellation
    ).toBe(true);
    expect(describeBackend(workflow).effectiveActions.cancellation).toBe(false);
    expect(
      describeBackend({ backend_type: 'langchain' }, 'admin').effectiveActions
        .cancellation
    ).toBe(false);
  });
  it('defaults only legacy missing types to Dify', () => {
    expect(resolveBackendType(null)).toBe('dify');
    expect(resolveBackendType({})).toBe('dify');
    expect(resolveBackendType({ backend_type: 'dify' })).toBe('dify');
    for (const backend of ['dsh', '', null, false]) {
      expect(() => resolveBackendType({ backend_type: backend })).toThrow(
        'AGENT_BACKEND_UNSUPPORTED'
      );
    }
  });

  it('advertises only implemented LangChain operations, not arbitrary config claims', () => {
    const config = {
      backend_type: 'langchain',
      langchain: {
        assistant_id: 'agent',
        apiKey: 'synthetic-private',
        capabilities: { humanInput: true, files: true },
      },
    };
    const descriptor = describeBackend(config);
    expect(descriptor).toMatchObject({
      backendType: 'langchain',
      persistence: 'server',
      capabilities: {
        humanInput: false,
        files: false,
        cancellation: false,
        tools: 'read-only-summary',
      },
    });
    expect(publicAppConfig(config)).toEqual({
      backend_type: 'langchain',
      app_metadata: {},
      langchain: {
        assistant_id: 'agent',
        capabilities: descriptor.capabilities,
      },
    });
    expect(JSON.stringify(descriptor)).not.toContain('synthetic-private');
    expect(describeBackend({})).toMatchObject({ persistence: 'browser' });
  });

  it('classifies named workflows as generation but not reads or stop', () => {
    for (const path of [
      'chat-messages',
      'completion-messages',
      'workflows/run',
      'workflows/published-version/run',
      'workflows/run/published-version',
    ])
      expect(isDifyGeneration('POST', path)).toBe(true);
    for (const path of ['files/upload', 'chat-messages/task/stop'])
      expect(isDifyGeneration('POST', path)).toBe(false);
    expect(isDifyGeneration('GET', 'workflows/run')).toBe(false);
  });
});
