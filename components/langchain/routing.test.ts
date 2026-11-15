import {
  agentAppPath,
  agentConversationPath,
  historyConversationPath,
  isCurrentLangchainConversation,
  langchainConversationPath,
} from './routing';

describe('public agent routes', () => {
  it('uses the service UUID for new LangChain and opted-in Dify chatbot chats', () => {
    expect(agentAppPath('service-uuid', { backend_type: 'langchain' })).toBe(
      '/apps/agent-chat/service-uuid'
    );
    expect(
      agentAppPath('service-uuid', {
        backend_type: 'dify',
        interaction_protocol: 'ag-ui/1.0',
        app_metadata: { app_type: 'marketplace', dify_apptype: 'chatbot' },
      })
    ).toBe('/apps/agent-chat/service-uuid');
    expect(
      agentAppPath('service-uuid', {
        interaction_protocol: 'ag-ui/1.0',
        app_metadata: { app_type: 'marketplace', dify_apptype: 'chatbot' },
      })
    ).toBe('/apps/agent-chat/service-uuid');
  });

  it.each(['agent', 'chatflow', 'workflow', 'text-generation', undefined])(
    'does not migrate Dify mode %s based on an opt-in alone',
    type => {
      expect(
        agentAppPath('service-uuid', {
          backend_type: 'dify',
          interaction_protocol: 'ag-ui/1.0',
          app_metadata: { app_type: 'marketplace', dify_apptype: type },
        })
      ).toBeNull();
    }
  );

  it('keeps unselected Dify and unknown backends out of public new-chat routing', () => {
    expect(agentAppPath('id')).toBeNull();
    expect(agentAppPath('id', { backend_type: 'dify' })).toBeNull();
    expect(
      agentAppPath('id', {
        backend_type: 'unknown',
        interaction_protocol: 'ag-ui/1.0',
        app_metadata: { dify_apptype: 'chatbot' },
      })
    ).toBeNull();
  });

  it.each(['model', undefined])(
    'does not route Dify app type %s publicly',
    type => {
      expect(
        agentAppPath('service', {
          backend_type: 'dify',
          interaction_protocol: 'ag-ui/1.0',
          app_metadata: { app_type: type, dify_apptype: 'chatbot' },
        })
      ).toBeNull();
    }
  );

  it('prioritizes the trusted conversation field over legacy brand metadata', () => {
    const conversation = {
      id: 'visible-id',
      db_pk: 'local-uuid',
      app_id: 'service-uuid',
      interaction_protocol: 'ag-ui/1.0' as const,
      metadata: { backend_type: 'langchain' },
    };
    const path = '/apps/agent-chat/service-uuid?conversationId=local-uuid';
    expect(agentConversationPath(conversation)).toBe(path);
    expect(langchainConversationPath(conversation)).toBe(path);
    expect(historyConversationPath('local-uuid', [conversation])).toBe(path);
    expect(historyConversationPath('visible-id', [conversation])).toBe(path);
  });

  it('does not treat user metadata or an app opt-in as proof of a bound Dify conversation', () => {
    const conversation = {
      id: 'local-id',
      external_id: 'native-id',
      app_id: 'service-uuid',
      interaction_protocol: null,
      metadata: { backend_type: 'dify', interaction_protocol: 'ag-ui/1.0' },
    };
    expect(agentConversationPath(conversation)).toBeNull();
    expect(historyConversationPath('native-id', [conversation])).toBe(
      '/chat/native-id'
    );
  });

  it('preserves the old URL for legacy LangChain conversations', () => {
    expect(
      langchainConversationPath({
        id: 'conversation',
        app_id: 'service',
        metadata: { backend_type: 'langchain' },
      })
    ).toBe('/apps/langchain/service?conversationId=conversation');
  });

  it.each(['agent-chat', 'langchain'])(
    'recognizes the active conversation under the %s alias without selecting another thread',
    prefix => {
      const href = `https://example.test/apps/${prefix}/service?conversationId=local&other=1`;
      expect(isCurrentLangchainConversation(href, 'service', 'local')).toBe(
        true
      );
      expect(isCurrentLangchainConversation(href, 'service', 'other')).toBe(
        false
      );
      expect(isCurrentLangchainConversation(href, 'other', 'local')).toBe(
        false
      );
    }
  );
});
