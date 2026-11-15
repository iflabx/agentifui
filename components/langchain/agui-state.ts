import type {
  AgentMessage,
  AgentRun,
} from '@lib/services/client/langchain-api';

import {
  AGUI_TOOL_SUMMARY,
  type AgentProjectionSnapshot,
  type Message,
  mergeAgentHistoryResult,
  readAgentHistoryResult,
} from '../../packages/shared/src/agui';
import { type AgentViewState, agentToolsFromMessages } from './state';

export function agentDisplayHistory(messages: AgentMessage[]): Message[] {
  return messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({
      id: message.id,
      role: message.role as 'user' | 'assistant',
      content: message.content,
    }));
}

export function projectAgentView(
  previous: AgentViewState,
  snapshot: AgentProjectionSnapshot,
  run?: AgentRun,
  ordering: AgentProjectionSnapshot['messages'] = snapshot.messages
): AgentViewState {
  const prior = new Map(
    previous.messages.map(message => [message.id, message])
  );
  const outputs = new Set(snapshot.outputMessageIds);
  const messages: AgentMessage[] = [];
  const tools = previous.tools.filter(tool => tool.runId !== snapshot.runId);
  const ordinals = new Map(
    ordering.map((message, index) => [message.id, index])
  );
  const anchors = new Map<
    string,
    { afterMessageId?: string; beforeMessageId?: string }
  >();
  let previousMessageId: string | undefined;
  for (const message of ordering) {
    if (message.role === 'user' || message.role === 'assistant')
      previousMessageId = message.id;
    else if (previousMessageId)
      anchors.set(message.id, { afterMessageId: previousMessageId });
  }
  let nextMessageId: string | undefined;
  for (const message of [...ordering].reverse()) {
    if (message.role === 'user' || message.role === 'assistant')
      nextMessageId = message.id;
    else if (!anchors.has(message.id) && nextMessageId)
      anchors.set(message.id, { beforeMessageId: nextMessageId });
  }
  for (const message of snapshot.messages) {
    const order = ordinals.get(message.id);
    if (
      message.role === 'activity' &&
      message.activityType === AGUI_TOOL_SUMMARY
    ) {
      if (outputs.has(message.id))
        tools.push({
          toolCallId: message.id,
          name: String(message.content.name),
          status: String(message.content.status),
          runId: snapshot.runId,
          order,
          ...anchors.get(message.id),
          ...(typeof message.content.parentMessageId === 'string'
            ? { messageId: message.content.parentMessageId }
            : {}),
        });
    } else if (message.role === 'user' || message.role === 'assistant') {
      messages.push({
        id: message.id,
        role: message.role,
        content: typeof message.content === 'string' ? message.content : '',
        metadata: {
          ...prior.get(message.id)?.metadata,
          ...(outputs.has(message.id)
            ? { backend_run_id: snapshot.runId, projection_order: order }
            : {}),
        },
      });
    }
  }
  return {
    conversationId: snapshot.threadId,
    runId: snapshot.runId,
    messages,
    tools,
    run: run ?? {
      id: snapshot.runId,
      executionStatus:
        snapshot.status === 'succeeded'
          ? 'success'
          : snapshot.status === 'failed'
            ? 'error'
            : snapshot.status,
      persistenceStatus: 'pending',
      ...(snapshot.errorCode ? { errorCode: snapshot.errorCode } : {}),
    },
  };
}

export function restoreAgentView(input: {
  conversationId: string;
  messages: AgentMessage[];
  runs: AgentRun[];
}): AgentViewState {
  let view: AgentViewState = {
    conversationId: input.conversationId,
    messages: input.messages,
    tools: agentToolsFromMessages(input.messages),
  };
  for (const run of [...input.runs].reverse()) {
    const runId = run.id || run.runId;
    if (!run.agui || !runId) continue;
    const history = readAgentHistoryResult(run.agui, {
      threadId: input.conversationId,
      runId,
    });
    const merged = mergeAgentHistoryResult(
      agentDisplayHistory(view.messages),
      history,
      run.persistenceStatus === 'saved'
        ? 'saved'
        : run.persistenceStatus === 'failed'
          ? 'failed'
          : 'pending'
    );
    view = projectAgentView(
      view,
      { ...history.projection, messages: merged.messages },
      run,
      history.projection.messages
    );
  }
  const run = input.runs[0];
  return { ...view, run, runId: run?.id || run?.runId };
}

export function recoverAgentRun(
  previous: AgentViewState,
  run: AgentRun
): AgentViewState {
  const messages = [
    ...previous.messages.filter(
      message =>
        !run.recoveryMessages?.some(recovery => recovery.id === message.id)
    ),
    ...(run.recoveryMessages ?? []),
  ];
  if (!run.agui || !previous.conversationId) {
    const tools = new Map(
      previous.tools.map(tool => [
        JSON.stringify([tool.runId, tool.toolCallId]),
        tool,
      ])
    );
    for (const tool of agentToolsFromMessages(messages))
      tools.set(JSON.stringify([tool.runId, tool.toolCallId]), tool);
    return {
      ...previous,
      run,
      messages,
      tools: [...tools.values()],
    };
  }
  const restored = restoreAgentView({
    conversationId: previous.conversationId,
    messages,
    runs: [run],
  });
  const runId = run.id || run.runId;
  return {
    ...restored,
    tools: [
      ...previous.tools.filter(tool => tool.runId !== runId),
      ...restored.tools,
    ],
  };
}
