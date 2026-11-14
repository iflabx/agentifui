/** @jest-environment node */
import { LANGCHAIN_CAPABILITIES } from '../../lib/agent-backends';
import {
  queryRowsWithPgSystemContext,
  queryRowsWithPgUserContext,
} from '../../lib/pg-context';
import { loadConversationOwnedByActor } from './auth';
import { handleConversationAction } from './conversation-actions';
import { handleGroupAuthAction } from './group-auth-actions';
import { handleMessageAction } from './message-actions';

jest.mock('../../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
  queryRowsWithPgUserContext: jest.fn(),
}));

const systemQuery = jest.mocked(queryRowsWithPgSystemContext);

beforeEach(() => {
  jest.resetAllMocks();
  systemQuery.mockResolvedValue([]);
});

describe('trusted backend conversation boundary', () => {
  it('checks owner, active actor/provider and live enabled app permission for history', async () => {
    systemQuery.mockResolvedValueOnce([{ id: 'conversation' }]);
    expect(await loadConversationOwnedByActor('conversation', 'actor')).toBe(
      true
    );
    const [sql, params] = systemQuery.mock.calls[0];
    expect(params).toEqual(['conversation', 'actor']);
    for (const predicate of [
      'user_id = $2::uuid',
      'binding.conversation_id = conversations.id',
      'instance.id = binding.service_instance_id',
      "actor.status = 'active'",
      'provider.is_active = TRUE',
      "instance.visibility = 'public'",
      "actor.role = 'admin'",
      "instance.visibility = 'group_only'",
      'permission.is_enabled = TRUE',
      'member.user_id = actor.id',
    ]) {
      expect(sql).toContain(predicate);
    }
    expect(sql).not.toContain('external_id');
    expect(sql).not.toContain('metadata');
  });

  it.each(['messages.getLatest', 'messages.getPage', 'messages.findDuplicate'])(
    'does not read %s after ownership or current app permission is lost',
    async action => {
      const response = await handleMessageAction(
        action,
        { conversationId: 'conversation', content: 'input', role: 'user' },
        'actor'
      );
      expect(response?.statusCode).toBe(404);
      expect(systemQuery).toHaveBeenCalledTimes(1);
      expect(systemQuery.mock.calls[0][0]).not.toContain('FROM messages');
    }
  );

  it.each([
    [
      'messages.save',
      {
        message: {
          conversation_id: 'conversation',
          role: 'assistant',
          content: 'forged',
        },
      },
    ],
    [
      'messages.updateMetadata',
      {
        conversationId: 'conversation',
        messageId: 'message',
        metadata: { native_run_id: 'forged' },
      },
    ],
    ['messages.createPlaceholder', { conversationId: 'conversation' }],
  ])('blocks generic %s for a bound conversation', async (action, payload) => {
    const response = await handleMessageAction(
      action as string,
      payload as Record<string, unknown>,
      'actor'
    );
    expect(response?.statusCode).toBe(404);
    expect(systemQuery).toHaveBeenCalledTimes(1);
    const sql = systemQuery.mock.calls[0][0];
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('FROM backend_conversations binding');
    expect(sql).not.toContain('OR EXISTS');
  });

  it.each(['messages.getLatest', 'messages.getPage'])(
    'allows %s for an owned permitted conversation without exposing bindings',
    async action => {
      systemQuery.mockResolvedValueOnce([{ id: 'conversation' }]);
      systemQuery.mockResolvedValueOnce([{ id: 'message', content: 'saved' }]);
      const response = await handleMessageAction(
        action,
        { conversationId: 'conversation' },
        'actor'
      );
      expect(response?.statusCode).toBe(200);
      expect(systemQuery.mock.calls[1][0]).not.toContain('thread_id');
      expect(systemQuery.mock.calls[1][0]).not.toContain('native_run_id');
    }
  );

  it.each([
    [
      'messages.save',
      {
        message: {
          conversation_id: 'conversation',
          role: 'user',
          content: 'input',
        },
      },
    ],
    [
      'messages.updateMetadata',
      { conversationId: 'conversation', messageId: 'message', metadata: {} },
    ],
    ['messages.createPlaceholder', { conversationId: 'conversation' }],
  ])(
    'preserves unbound %s with a binding guard at the write itself',
    async (action, payload) => {
      systemQuery.mockResolvedValueOnce([{ id: 'conversation' }]);
      systemQuery.mockResolvedValueOnce([{ id: 'message', content: 'input' }]);
      const response = await handleMessageAction(
        action as string,
        payload as Record<string, unknown>,
        'actor'
      );
      expect(response?.statusCode).toBe(200);
      const sql = systemQuery.mock.calls[1][0];
      expect(sql).toContain('NOT EXISTS');
      expect(sql).toContain('FROM backend_conversations binding');
      expect(sql).not.toContain('native_run_id');
    }
  );

  it.each([
    'conversations.getUserConversations',
    'conversations.getConversationByExternalId',
  ])(
    'filters %s using the trusted binding, including list totals',
    async action => {
      await handleConversationAction(
        action,
        { externalId: 'external' },
        'actor'
      );
      for (const [sql] of systemQuery.mock.calls) {
        expect(sql).toContain('FROM backend_conversations binding');
        expect(sql).toContain('provider.is_active = TRUE');
        expect(sql).toContain('permission.is_enabled = TRUE');
        expect(sql).not.toContain('thread_id');
        expect(sql).not.toContain('native_run_id');
      }
      expect(systemQuery).toHaveBeenCalledTimes(
        action.endsWith('getUserConversations') ? 2 : 1
      );
    }
  );

  it.each([
    'instance-name',
    '00000000-0000-4000-8000-000000000001',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  ])(
    'rejects generic creation for a LangChain app identifier %s',
    async appId => {
      const response = await handleConversationAction(
        'conversations.createConversation',
        { conversation: { app_id: appId } },
        'actor'
      );
      expect(response?.statusCode).toBe(409);
      const [sql, params] = systemQuery.mock.calls[0];
      expect(sql).toContain(
        'lower(instance.id::text) = lower($9::text) OR instance.instance_id = $9::text'
      );
      expect(sql).toMatch(/\$8,\s+\$9::text,/);
      expect(sql).toContain("instance.config ->> 'backend_type' = 'langchain'");
      expect(params?.[8]).toBe(appId);
    }
  );

  it('does not treat forged backend metadata as a trusted mapping', async () => {
    systemQuery.mockResolvedValueOnce([
      {
        id: 'local',
        metadata: { backend_type: 'langchain', thread_id: 'fake' },
      },
    ]);
    const response = await handleConversationAction(
      'conversations.createConversation',
      {
        conversation: {
          metadata: { backend_type: 'langchain', thread_id: 'fake' },
        },
      },
      'actor'
    );
    expect(response?.statusCode).toBe(200);
    expect(systemQuery.mock.calls[0][0]).not.toContain(
      'INSERT INTO backend_conversations'
    );
  });

  it.each([
    'conversations.renameConversation',
    'conversations.deleteConversation',
  ])(
    'preserves owner-only local %s even after app revocation',
    async action => {
      systemQuery.mockResolvedValueOnce([{ id: 'conversation' }]);
      const response = await handleConversationAction(
        action,
        { conversationId: 'conversation', title: 'Renamed' },
        'actor'
      );
      expect(response?.statusCode).toBe(200);
      expect(systemQuery.mock.calls[0][0]).toContain('AND user_id =');
      expect(systemQuery.mock.calls[0][0]).not.toContain(
        'backend_conversations'
      );
      expect(systemQuery.mock.calls[0][1]).toContain('actor');
    }
  );

  it('blocks generic generated-title sync on trusted conversations', async () => {
    await handleConversationAction(
      'conversations.syncGeneratedTitleIfPlaceholder',
      {
        conversationId: 'conversation',
        title: 'Generated',
        placeholderTitles: ['New'],
      },
      'actor'
    );
    expect(systemQuery.mock.calls[0][0]).toContain('NOT EXISTS');
    expect(systemQuery.mock.calls[0][0]).toContain(
      'FROM backend_conversations binding'
    );
  });

  it('redacts backend connection settings from group application results', async () => {
    jest.mocked(queryRowsWithPgUserContext).mockResolvedValueOnce([
      {
        service_instance_id: 'app',
        api_path: 'http://private.invalid/secret',
        config: {
          backend_type: 'langchain',
          api_url: 'http://private.invalid',
          app_metadata: {
            brief_description: 'Public description',
            api_key: 'hidden',
          },
          langchain: {
            assistant_id: 'agent',
            token: 'hidden',
            base_url: 'http://private.invalid',
          },
        },
      },
    ]);
    const response = await handleGroupAuthAction(
      'groups.getUserAccessibleApps',
      {},
      'actor'
    );
    expect(response?.payload).toEqual({
      success: true,
      data: [
        {
          service_instance_id: 'app',
          api_path: '',
          config: {
            backend_type: 'langchain',
            app_metadata: { brief_description: 'Public description' },
            langchain: {
              assistant_id: 'agent',
              capabilities: LANGCHAIN_CAPABILITIES,
            },
          },
        },
      ],
    });
    expect(JSON.stringify(response)).not.toContain('hidden');
    expect(JSON.stringify(response)).not.toContain('private.invalid');
  });
});
