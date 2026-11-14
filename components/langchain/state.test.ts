import { agentRunSaved } from '@lib/services/client/langchain-api';

import {
  historyConversationPath,
  isCurrentLangchainConversation,
  langchainConversationPath,
} from './routing';
import {
  agentTimeline,
  agentToolsFromMessages,
  markAgentStreamInterrupted,
  reduceAgentEvent,
} from './state';
import type { AgentViewState } from './state';

describe('server-managed agent state', () => {
  const initial: AgentViewState = { messages: [], tools: [] };
  it('keeps A-tool-B ordering per run in streaming and refreshed multi-turn history', () => {
    let state: AgentViewState = initial;
    for (const runId of ['first-run', 'second-run']) {
      state = {
        ...state,
        messages: [
          ...state.messages,
          { id: `${runId}-user`, role: 'user', content: 'question' },
        ],
      };
      state = reduceAgentEvent(state, {
        type: 'accepted',
        conversationId: 'local',
        runId,
        userMessageId: `${runId}-user`,
      });
      state = reduceAgentEvent(state, {
        type: 'text',
        messageId: `${runId}-A`,
        delta: 'A',
        runId,
        order: 0,
      });
      state = reduceAgentEvent(state, {
        type: 'tool',
        toolCallId: 'reused-native-id',
        name: 'lookup',
        status: 'running',
        runId,
        messageId: `${runId}-A`,
        order: 1,
      });
      state = reduceAgentEvent(state, {
        type: 'tool',
        toolCallId: 'reused-native-id',
        name: 'lookup',
        status: 'completed',
        runId,
        messageId: `${runId}-A`,
        order: 1,
      });
      state = reduceAgentEvent(state, {
        type: 'text',
        messageId: `${runId}-B`,
        delta: 'B',
        runId,
        order: 2,
      });
    }
    const display = (view: AgentViewState) =>
      agentTimeline(view).map(item =>
        item.type === 'message' ? item.message.content : item.tool.name
      );
    expect(display(state)).toEqual([
      'question',
      'A',
      'lookup',
      'B',
      'question',
      'A',
      'lookup',
      'B',
    ]);
    expect(state.tools).toHaveLength(2);
    const messages = state.messages.map(message => ({
      ...message,
      metadata: {
        ...message.metadata,
        tools: state.tools.filter(tool => tool.messageId === message.id),
      },
    }));
    expect(
      display({ messages, tools: agentToolsFromMessages(messages) })
    ).toEqual(display(state));
  });

  it('leaves legacy summaries unordered instead of inventing message association', () => {
    const messages = [
      {
        id: 'legacy',
        role: 'assistant',
        content: 'Old answer',
        metadata: {
          backend_run_id: 'old-run',
          tools: [
            { toolCallId: 'old-tool', name: 'lookup', status: 'completed' },
          ],
        },
      },
    ];
    const tools = agentToolsFromMessages(messages);
    expect(tools[0]).toMatchObject({ runId: 'old-run' });
    expect(tools[0].order).toBeUndefined();
    expect(tools[0].messageId).toBeUndefined();
    expect(agentTimeline({ messages, tools }).map(item => item.type)).toEqual([
      'message',
      'tool',
    ]);
  });
  it('opens LangChain from global history without routing through Dify', () => {
    expect(
      historyConversationPath('local-id', [
        {
          id: 'local-id',
          app_id: 'app-uuid',
          metadata: { backend_type: 'langchain' },
        },
      ])
    ).toBe('/apps/langchain/app-uuid?conversationId=local-id');
    expect(
      historyConversationPath('external-dify', [
        {
          id: 'local-dify',
          external_id: 'external-dify',
          app_id: 'dify-app',
        },
      ])
    ).toBe('/chat/external-dify');
    expect(historyConversationPath('not-loaded', [])).toBe('/chat/not-loaded');
  });
  it('does not redirect the active page when another conversation is deleted', () => {
    expect(
      isCurrentLangchainConversation(
        'https://example.org/apps/langchain/app?conversationId=B',
        'app',
        'A'
      )
    ).toBe(false);
    expect(
      isCurrentLangchainConversation(
        'https://example.org/apps/langchain/app?conversationId=B',
        'app',
        'B'
      )
    ).toBe(true);
    expect(
      isCurrentLangchainConversation(
        'https://example.org/apps/langchain/other?conversationId=B',
        'app',
        'B'
      )
    ).toBe(false);
  });
  it('restores only safe tool summary fields from history', () => {
    expect(
      agentToolsFromMessages([
        {
          id: 'assistant',
          role: 'assistant',
          content: '',
          metadata: {
            tools: [
              {
                toolCallId: 'tool',
                name: 'lookup',
                status: 'completed',
                args: 'private',
                result: 'private',
              },
            ],
          },
        },
      ])
    ).toEqual([{ toolCallId: 'tool', name: 'lookup', status: 'completed' }]);
  });
  it('keeps multiple assistant message identities and tool summaries', () => {
    let state = reduceAgentEvent(initial, {
      type: 'accepted',
      conversationId: 'local',
      runId: 'run',
      userMessageId: 'user',
    });
    state = reduceAgentEvent(state, {
      type: 'text',
      messageId: 'one',
      delta: 'Hello',
    });
    state = reduceAgentEvent(state, {
      type: 'text',
      messageId: 'one',
      delta: ' world',
    });
    state = reduceAgentEvent(state, {
      type: 'text',
      messageId: 'two',
      delta: 'Next',
    });
    state = reduceAgentEvent(state, {
      type: 'tool',
      toolCallId: 'tool',
      name: 'lookup',
      status: 'complete',
      summary: 'Safe result',
    });
    expect(state.messages.map(message => message.content)).toEqual([
      'Hello world',
      'Next',
    ]);
    expect(state.tools).toHaveLength(1);
    expect(state.conversationId).toBe('local');
  });
  it('never treats EOF or native success with failed persistence as saved', () => {
    const state = reduceAgentEvent(initial, {
      type: 'accepted',
      conversationId: 'local',
      runId: 'run',
      userMessageId: 'user',
    });
    expect(markAgentStreamInterrupted(state).run?.executionStatus).toBe(
      'unknown'
    );
    expect(
      agentRunSaved({ executionStatus: 'success', persistenceStatus: 'error' })
    ).toBe(false);
    expect(
      agentRunSaved({ executionStatus: 'success', persistenceStatus: 'saved' })
    ).toBe(true);
  });
  it('does not downgrade a confirmed saved terminal on EOF', () => {
    const state = reduceAgentEvent(initial, {
      type: 'status',
      executionStatus: 'success',
      persistenceStatus: 'saved',
    });
    expect(markAgentStreamInterrupted(state)).toBe(state);
  });
  it('routes trusted local conversation identities, never external thread IDs', () => {
    expect(
      langchainConversationPath({
        id: 'external-thread',
        db_pk: 'local-id',
        app_id: 'app-uuid',
        metadata: { backend_type: 'langchain' },
      })
    ).toBe('/apps/langchain/app-uuid?conversationId=local-id');
    expect(
      langchainConversationPath({ id: 'dify', app_id: 'old-app' })
    ).toBeNull();
  });
});
