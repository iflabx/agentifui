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
  runId?: string;
  messageId?: string;
  order?: number;
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
      const runId =
        typeof tool.runId === 'string'
          ? tool.runId
          : message.metadata?.backend_run_id;
      tools.set(JSON.stringify([runId, tool.toolCallId]), {
        toolCallId: tool.toolCallId,
        name: tool.name.slice(0, 100),
        status: tool.status.slice(0, 40),
        ...(typeof runId === 'string' ? { runId } : {}),
        ...(typeof tool.messageId === 'string'
          ? { messageId: tool.messageId }
          : {}),
        ...(Number.isSafeInteger(tool.order) && Number(tool.order) >= 0
          ? { order: Number(tool.order) }
          : {}),
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
      messages: state.messages.map((message, index) =>
        index === state.messages.length - 1 && message.role === 'user'
          ? { ...message, id: event.userMessageId }
          : message
      ),
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
            {
              id: event.messageId,
              role: 'assistant',
              content: event.delta,
              metadata: {
                backend_run_id: event.runId || state.runId,
                projection_order: event.order,
              },
            },
          ],
    };
  }
  if (event.type === 'tool')
    return {
      ...state,
      tools: [
        ...state.tools.filter(
          tool =>
            tool.toolCallId !== event.toolCallId ||
            tool.runId !== (event.runId || state.runId)
        ),
        {
          toolCallId: event.toolCallId,
          name: event.name,
          status: event.status,
          summary: event.summary,
          runId: event.runId || state.runId,
          messageId: event.messageId,
          order: event.order,
        },
      ],
    };
  return { ...state, run: event };
}

export type AgentTimelineItem =
  | { type: 'message'; message: AgentMessage }
  | { type: 'tool'; tool: AgentToolSummary };

export function agentTimeline(state: AgentViewState): AgentTimelineItem[] {
  const result: AgentTimelineItem[] = [];
  const rendered = new Set<AgentToolSummary>();
  for (let index = 0; index < state.messages.length; index += 1) {
    const message = state.messages[index];
    const runId = message.metadata?.backend_run_id;
    if (message.role !== 'assistant' || typeof runId !== 'string') {
      result.push({ type: 'message', message });
      continue;
    }
    const group: AgentTimelineItem[] = [{ type: 'message', message }];
    while (
      state.messages[index + 1]?.role === 'assistant' &&
      state.messages[index + 1]?.metadata?.backend_run_id === runId
    ) {
      group.push({ type: 'message', message: state.messages[++index] });
    }
    for (const tool of state.tools) {
      if (tool.runId !== runId || rendered.has(tool)) continue;
      group.push({ type: 'tool', tool });
      rendered.add(tool);
    }
    const order = (item: AgentTimelineItem) =>
      item.type === 'tool'
        ? item.tool.order
        : item.message.metadata?.projection_order;
    group.sort((left, right) => {
      const leftOrder = order(left);
      const rightOrder = order(right);
      return (
        (typeof leftOrder === 'number' ? leftOrder : Infinity) -
        (typeof rightOrder === 'number' ? rightOrder : Infinity)
      );
    });
    result.push(...group);
  }
  for (const tool of state.tools) {
    if (!rendered.has(tool)) result.push({ type: 'tool', tool });
  }
  return result;
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
