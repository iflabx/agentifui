import type {
  AgentEvent,
  AgentMessage,
  AgentRun,
} from '@lib/services/client/langchain-api';

export interface AgentToolSummary {
  toolCallId: string;
  name: string;
  status: string;
  summary?: string;
}

export interface AgentViewState {
  conversationId?: string;
  runId?: string;
  messages: AgentMessage[];
  tools: AgentToolSummary[];
  run?: AgentRun;
}

export function agentToolsFromMessages(
  messages: AgentMessage[]
): AgentToolSummary[] {
  const tools = new Map<string, AgentToolSummary>();
  for (const message of messages) {
    const values = message.metadata?.tools;
    if (!Array.isArray(values)) continue;
    for (const value of values.slice(0, 100)) {
      if (!value || typeof value !== 'object') continue;
      const tool = value as Record<string, unknown>;
      if (
        typeof tool.toolCallId !== 'string' ||
        typeof tool.name !== 'string' ||
        typeof tool.status !== 'string'
      )
        continue;
      tools.set(tool.toolCallId, {
        toolCallId: tool.toolCallId,
        name: tool.name.slice(0, 100),
        status: tool.status.slice(0, 40),
        ...(typeof tool.summary === 'string'
          ? { summary: tool.summary.slice(0, 2000) }
          : {}),
      });
    }
  }
  return [...tools.values()];
}

export function reduceAgentEvent(
  state: AgentViewState,
  event: AgentEvent
): AgentViewState {
  if (event.type === 'accepted')
    return {
      ...state,
      conversationId: event.conversationId,
      runId: event.runId,
      run: {
        id: event.runId,
        executionStatus: 'running',
        persistenceStatus: 'pending',
      },
    };
  if (event.type === 'text') {
    const existing = state.messages.find(
      message => message.id === event.messageId
    );
    return {
      ...state,
      messages: existing
        ? state.messages.map(message =>
            message.id === event.messageId
              ? { ...message, content: message.content + event.delta }
              : message
          )
        : [
            ...state.messages,
            { id: event.messageId, role: 'assistant', content: event.delta },
          ],
    };
  }
  if (event.type === 'tool')
    return {
      ...state,
      tools: [
        ...state.tools.filter(tool => tool.toolCallId !== event.toolCallId),
        {
          toolCallId: event.toolCallId,
          name: event.name,
          status: event.status,
          summary: event.summary,
        },
      ],
    };
  return { ...state, run: event };
}

export function markAgentStreamInterrupted(
  state: AgentViewState
): AgentViewState {
  if (
    state.run &&
    state.run.executionStatus !== 'running' &&
    state.run.executionStatus !== 'pending'
  )
    return state;
  return {
    ...state,
    run: {
      id: state.runId,
      executionStatus: 'unknown',
      persistenceStatus: state.run?.persistenceStatus || 'pending',
    },
  };
}
